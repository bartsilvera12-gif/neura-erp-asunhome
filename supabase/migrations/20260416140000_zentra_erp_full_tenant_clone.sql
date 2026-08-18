-- =============================================================================
-- Clonación COMPLETA de zentra_erp → schema tenant (estructura vacía).
-- Catálogo global (no se clona): empresas, usuarios, modulos, empresa_modulos,
-- usuario_modulos, omnichannel_routes.
-- FKs hacia esas tablas permanecen como REFERENCES zentra_erp.*.
-- =============================================================================

-- Quitar provisión parcial anterior
DROP FUNCTION IF EXISTS zentra_erp.neura_clone_omnicanal_schema(text);

DROP FUNCTION IF EXISTS zentra_erp.neura_provision_empresa_data_schema(uuid);
DROP FUNCTION IF EXISTS zentra_erp.neura_provision_empresa_data_schema(uuid, text);
DROP FUNCTION IF EXISTS zentra_erp.neura_teardown_provision_failed(uuid);
DROP FUNCTION IF EXISTS zentra_erp.neura_resolve_sorteo_revendedor_public(uuid, text);

-- -----------------------------------------------------------------------------
-- Helper: reescribe zentra_erp.<tabla> → <tgt>.<tabla> (tablas clonadas, orden largo→corto)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION zentra_erp._neura_rewrite_zentra_tables(p_expr text, p_tgt text, p_tables text[])
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  r text := p_expr;
  t text;
  sorted text[];
BEGIN
  IF p_expr IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT coalesce(array_agg(x ORDER BY length(x) DESC), '{}')
  INTO sorted
  FROM unnest(p_tables) AS x;

  FOREACH t IN ARRAY sorted
  LOOP
    r := replace(r, 'zentra_erp."' || t || '"', p_tgt || '."' || t || '"');
    r := replace(r, 'zentra_erp.' || t, p_tgt || '.' || t);
  END LOOP;
  RETURN r;
END;
$$;

-- -----------------------------------------------------------------------------
-- Sanitizar slug UI → fragmento de nombre de schema (sin prefijo erp_)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION zentra_erp.neura_sanitize_schema_slug(p_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v text;
BEGIN
  v := lower(trim(coalesce(p_raw, '')));
  v := regexp_replace(v, '[^a-z0-9]+', '_', 'g');
  v := regexp_replace(v, '^_+|_+$', '', 'g');
  IF v IS NULL OR length(v) < 2 THEN
    v := 'empresa';
  END IF;
  IF length(v) > 40 THEN
    v := substring(v from 1 for 40);
  END IF;
  RETURN v;
END;
$$;

-- -----------------------------------------------------------------------------
-- Nombre final: erp_<slug>_<8 hex de empresa_id> (único y válido como identifier)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION zentra_erp.neura_build_tenant_schema_name(p_slug text, p_empresa_id uuid)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s text;
  suf text;
  v_schema_name text;
BEGIN
  s := zentra_erp.neura_sanitize_schema_slug(p_slug);
  suf := substring(replace(p_empresa_id::text, '-', '') from 1 for 8);
  v_schema_name := 'erp_' || s || '_' || suf;
  IF v_schema_name !~ '^erp_[a-z0-9_]+$' OR length(v_schema_name) > 63 THEN
    RAISE EXCEPTION 'nombre de schema inválido tras sanitizar: %', v_schema_name;
  END IF;
  RETURN v_schema_name;
END;
$$;

-- -----------------------------------------------------------------------------
-- Lista tablas a clonar (todas las relaciones en zentra_erp excepto catálogo)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION zentra_erp._neura_tenant_clone_table_list()
RETURNS text[]
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(array_agg(c.relname::text ORDER BY c.relname), '{}')
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'zentra_erp'
    AND c.relkind = 'r'
    AND c.relname NOT IN (
      'empresas',
      'usuarios',
      'modulos',
      'empresa_modulos',
      'usuario_modulos',
      'omnichannel_routes'
    );
$$;

-- -----------------------------------------------------------------------------
-- Clonación estructural principal
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION zentra_erp.neura_clone_zentra_erp_to_tenant(p_target_schema text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = zentra_erp, pg_catalog
AS $$
DECLARE
  v_tables text[] := zentra_erp._neura_tenant_clone_table_list();
  v_tgt text := quote_ident(p_target_schema);
  r RECORD;
  def text;
  idef text;
  tdef text;
  qual text;
  chk text;
  roles_clause text;
  tbl text;
  v_pub text := 'supabase_realtime';
  fn_oid oid;
  fdef text;
  v_round int;
  v_now int;
  v_viewdef text;
  v_pass int;
BEGIN
  IF p_target_schema !~ '^erp_[a-z0-9_]+$' OR length(p_target_schema) > 63 THEN
    RAISE EXCEPTION 'schema tenant inválido: %', p_target_schema;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = p_target_schema) THEN
    RAISE EXCEPTION 'el esquema % ya existe', p_target_schema;
  END IF;

  EXECUTE format('CREATE SCHEMA %I', p_target_schema);

  EXECUTE format(
    'GRANT USAGE ON SCHEMA %I TO postgres, anon, authenticated, service_role',
    p_target_schema
  );

  FOREACH tbl IN ARRAY v_tables
  LOOP
    EXECUTE format(
      'CREATE TABLE %s.%I (LIKE zentra_erp.%I INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING IDENTITY INCLUDING STATISTICS INCLUDING STORAGE INCLUDING COMMENTS EXCLUDING CONSTRAINTS EXCLUDING INDEXES)',
      v_tgt,
      tbl,
      tbl
    );
  END LOOP;

  -- PK, UNIQUE, CHECK
  FOR r IN
    SELECT c.oid, c.conname::text AS conname, cf.relname::text AS relname, c.contype::text AS ctype
    FROM pg_constraint c
    JOIN pg_class cf ON cf.oid = c.conrelid
    JOIN pg_namespace nf ON nf.oid = cf.relnamespace
    WHERE nf.nspname = 'zentra_erp'
      AND c.contype IN ('p', 'u', 'c')
      AND cf.relname = ANY (v_tables)
    ORDER BY
      CASE c.contype WHEN 'p' THEN 1 WHEN 'u' THEN 2 WHEN 'c' THEN 3 ELSE 4 END,
      c.conname
  LOOP
    def := pg_get_constraintdef(r.oid);
    def := zentra_erp._neura_rewrite_zentra_tables(def, v_tgt, v_tables);
    BEGIN
      EXECUTE format(
        'ALTER TABLE %s.%I ADD CONSTRAINT %I %s',
        v_tgt,
        r.relname,
        r.conname,
        def
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'neura_full_clone: constraint %.% omitido: %', r.relname, r.conname, SQLERRM;
    END;
  END LOOP;

  -- Índices secundarios
  FOR r IN
    SELECT pg_get_indexdef(i.oid) AS idef
    FROM pg_class i
    JOIN pg_namespace n ON n.oid = i.relnamespace
    JOIN pg_index ix ON ix.indexrelid = i.oid
    JOIN pg_class tbl ON tbl.oid = ix.indrelid
    WHERE n.nspname = 'zentra_erp'
      AND i.relkind = 'i'
      AND ix.indisprimary IS FALSE
      AND NOT EXISTS (SELECT 1 FROM pg_constraint co WHERE co.conindid = i.oid)
      AND tbl.relname = ANY (v_tables)
  LOOP
    idef := zentra_erp._neura_rewrite_zentra_tables(r.idef, v_tgt, v_tables);
    BEGIN
      EXECUTE idef;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'neura_full_clone: índice omitido: %', SQLERRM;
    END;
  END LOOP;

  -- Foreign keys
  FOR r IN
    SELECT c.oid, c.conname::text AS conname, cf.relname::text AS from_table
    FROM pg_constraint c
    JOIN pg_class cf ON cf.oid = c.conrelid
    JOIN pg_namespace nf ON nf.oid = cf.relnamespace
    WHERE nf.nspname = 'zentra_erp'
      AND c.contype = 'f'
      AND cf.relname = ANY (v_tables)
    ORDER BY c.conname
  LOOP
    def := pg_get_constraintdef(r.oid);
    def := zentra_erp._neura_rewrite_zentra_tables(def, v_tgt, v_tables);
    BEGIN
      EXECUTE format(
        'ALTER TABLE %s.%I ADD CONSTRAINT %I %s',
        v_tgt,
        r.from_table,
        r.conname,
        def
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'neura_full_clone: FK %.% omitido: %', r.from_table, r.conname, SQLERRM;
    END;
  END LOOP;

  -- Triggers (funciones ejecutadas suelen vivir en zentra_erp)
  FOR r IN
    SELECT
      tg.tgname::text AS tgname,
      c.relname::text AS tablename,
      pg_get_triggerdef(tg.oid, true) AS tdef
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'zentra_erp'
      AND NOT tg.tgisinternal
      AND c.relname = ANY (v_tables)
  LOOP
    tdef := r.tdef;
    tdef := replace(tdef, ' ON zentra_erp.' || r.tablename || ' ', ' ON ' || v_tgt || '.' || r.tablename || ' ');
    tdef := replace(tdef, ' ON zentra_erp."' || r.tablename || '" ', ' ON ' || v_tgt || '."' || r.tablename || '" ');
    BEGIN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON %s.%I', r.tgname, v_tgt, r.tablename);
      EXECUTE tdef;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'neura_full_clone: trigger % en % omitido: %', r.tgname, r.tablename, SQLERRM;
    END;
  END LOOP;

  -- RLS + policies
  FOREACH tbl IN ARRAY v_tables
  LOOP
    EXECUTE format('ALTER TABLE %s.%I ENABLE ROW LEVEL SECURITY', v_tgt, tbl);
  END LOOP;

  FOR r IN
    SELECT
      pol.polname::text AS polname,
      c.relname::text AS tablename,
      pol.polcmd::text AS cmd,
      pol.polpermissive AS permissive,
      pg_get_expr(pol.polqual, pol.polrelid) AS polqual,
      pg_get_expr(pol.polwithcheck, pol.polrelid) AS polwithcheck,
      ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY (pol.polroles)) AS roles
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'zentra_erp'
      AND c.relname = ANY (v_tables)
  LOOP
    BEGIN
      qual := zentra_erp._neura_rewrite_zentra_tables(r.polqual, v_tgt, v_tables);
      chk := zentra_erp._neura_rewrite_zentra_tables(r.polwithcheck, v_tgt, v_tables);

      IF r.roles IS NULL OR coalesce(cardinality(r.roles), 0) = 0 THEN
        roles_clause := '';
      ELSE
        roles_clause := ' TO ' || (SELECT string_agg(quote_ident(x), ', ') FROM unnest(r.roles) AS x);
      END IF;

      EXECUTE format('DROP POLICY IF EXISTS %I ON %s.%I', r.polname, v_tgt, r.tablename);

      IF r.cmd = 'r' THEN
        EXECUTE format(
          'CREATE POLICY %I ON %s.%I AS %s FOR SELECT%s USING (%s)',
          r.polname,
          v_tgt,
          r.tablename,
          CASE WHEN r.permissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
          roles_clause,
          coalesce(qual, 'true')
        );
      ELSIF r.cmd = 'a' THEN
        EXECUTE format(
          'CREATE POLICY %I ON %s.%I AS %s FOR INSERT%s WITH CHECK (%s)',
          r.polname,
          v_tgt,
          r.tablename,
          CASE WHEN r.permissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
          roles_clause,
          coalesce(chk, qual, 'true')
        );
      ELSIF r.cmd = 'w' THEN
        EXECUTE format(
          'CREATE POLICY %I ON %s.%I AS %s FOR UPDATE%s USING (%s) WITH CHECK (%s)',
          r.polname,
          v_tgt,
          r.tablename,
          CASE WHEN r.permissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
          roles_clause,
          coalesce(qual, 'true'),
          coalesce(chk, qual, 'true')
        );
      ELSIF r.cmd = 'd' THEN
        EXECUTE format(
          'CREATE POLICY %I ON %s.%I AS %s FOR DELETE%s USING (%s)',
          r.polname,
          v_tgt,
          r.tablename,
          CASE WHEN r.permissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
          roles_clause,
          coalesce(qual, 'true')
        );
      ELSIF r.cmd = '*' THEN
        EXECUTE format(
          'CREATE POLICY %I ON %s.%I AS %s FOR ALL%s USING (%s) WITH CHECK (%s)',
          r.polname,
          v_tgt,
          r.tablename,
          CASE WHEN r.permissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
          roles_clause,
          coalesce(qual, 'true'),
          coalesce(chk, qual, 'true')
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'neura_full_clone: policy % en % omitido: %', r.polname, r.tablename, SQLERRM;
    END;
  END LOOP;

  -- Grants tablas / secuencias
  EXECUTE format(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO authenticated',
    p_target_schema
  );
  EXECUTE format(
    'GRANT ALL ON ALL TABLES IN SCHEMA %I TO postgres, service_role',
    p_target_schema
  );
  EXECUTE format(
    'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO authenticated',
    p_target_schema
  );
  EXECUTE format(
    'GRANT ALL ON ALL SEQUENCES IN SCHEMA %I TO postgres, service_role',
    p_target_schema
  );

  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated',
    p_target_schema
  );
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA %I GRANT ALL ON TABLES TO postgres, service_role',
    p_target_schema
  );

  -- Vistas estándar (varias pasadas por dependencias)
  FOR v_pass IN 1..12
  LOOP
    FOR r IN
      SELECT c.relname::text AS vname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'zentra_erp'
        AND c.relkind = 'v'
    LOOP
      SELECT pg_get_viewdef(format('zentra_erp.%I', r.vname)::regclass, true)
      INTO v_viewdef;
      IF v_viewdef IS NULL THEN
        CONTINUE;
      END IF;
      v_viewdef := zentra_erp._neura_rewrite_zentra_tables(v_viewdef, v_tgt, v_tables);
      BEGIN
        EXECUTE format('DROP VIEW IF EXISTS %s.%I CASCADE', v_tgt, r.vname);
        EXECUTE format('CREATE VIEW %s.%I AS %s', v_tgt, r.vname, v_viewdef);
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'neura_full_clone: vista % pasada % omitida: %', r.vname, v_pass, SQLERRM;
      END;
    END LOOP;
  END LOOP;

  -- Materialized views
  FOR r IN
    SELECT c.relname::text AS mname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'zentra_erp'
      AND c.relkind = 'm'
  LOOP
    SELECT pg_get_viewdef(format('zentra_erp.%I', r.mname)::regclass, true) INTO v_viewdef;
    IF v_viewdef IS NULL THEN
      CONTINUE;
    END IF;
    v_viewdef := zentra_erp._neura_rewrite_zentra_tables(v_viewdef, v_tgt, v_tables);
    BEGIN
      EXECUTE format('DROP MATERIALIZED VIEW IF EXISTS %s.%I CASCADE', v_tgt, r.mname);
      EXECUTE format('CREATE MATERIALIZED VIEW %s.%I AS %s WITH NO DATA', v_tgt, r.mname, v_viewdef);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'neura_full_clone: matview % omitida: %', r.mname, SQLERRM;
    END;
  END LOOP;

  -- Funciones / RPC (plpgsql/sql): varias rondas hasta estabilizar dependencias
  FOR v_round IN 1..20
  LOOP
    v_now := 0;
    FOR fn_oid IN
      SELECT p.oid
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      JOIN pg_language l ON p.prolang = l.oid
      WHERE n.nspname = 'zentra_erp'
        AND p.prokind IN ('f', 'p')
        AND l.lanname IN ('plpgsql', 'sql')
        AND p.proname NOT IN (
          'empresa_id_actual',
          'es_super_admin',
          'puede_acceder_empresa',
          'set_updated_at'
        )
        AND p.proname NOT LIKE E'\\_neura\\_%' ESCAPE '\'
        AND p.proname NOT LIKE 'neura\\_%' ESCAPE '\'
    LOOP
      fdef := pg_get_functiondef(fn_oid);
      IF fdef IS NULL OR position('CREATE OR REPLACE FUNCTION zentra_erp.' IN fdef) = 0 THEN
        CONTINUE;
      END IF;
      fdef := replace(fdef, 'CREATE OR REPLACE FUNCTION zentra_erp.', 'CREATE OR REPLACE FUNCTION ' || v_tgt || '.');
      fdef := zentra_erp._neura_rewrite_zentra_tables(fdef, v_tgt, v_tables);
      BEGIN
        EXECUTE fdef;
        v_now := v_now + 1;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END LOOP;
    EXIT WHEN v_now = 0;
  END LOOP;

  EXECUTE format(
    'GRANT EXECUTE ON ALL ROUTINES IN SCHEMA %I TO authenticated, service_role',
    p_target_schema
  );
  EXECUTE format(
    'GRANT ALL ON ALL ROUTINES IN SCHEMA %I TO postgres, service_role',
    p_target_schema
  );

  -- Realtime: copiar membresía de tablas zentra_erp → tenant
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = v_pub) THEN
    FOR r IN
      SELECT pt.tablename::text AS tablename
      FROM pg_publication_tables pt
      WHERE pt.pubname = v_pub
        AND pt.schemaname = 'zentra_erp'
        AND pt.tablename = ANY (v_tables)
    LOOP
      BEGIN
        EXECUTE format(
          'ALTER PUBLICATION %I ADD TABLE %I.%I',
          v_pub,
          p_target_schema,
          r.tablename
        );
      EXCEPTION WHEN duplicate_object THEN
        NULL;
      WHEN OTHERS THEN
        RAISE NOTICE 'neura_full_clone: realtime % omitido: %', r.tablename, SQLERRM;
      END;
    END LOOP;
  END IF;

  PERFORM pg_notify('pgrst', 'reload schema');
END;
$$;

REVOKE ALL ON FUNCTION zentra_erp.neura_clone_zentra_erp_to_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zentra_erp.neura_clone_zentra_erp_to_tenant(text) TO service_role;

-- -----------------------------------------------------------------------------
-- Resolver revendedor para enlace público /r/{codigo} (escanea schemas tenant)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION zentra_erp.neura_resolve_sorteo_revendedor_public(
  p_sorteo_id uuid,
  p_codigo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = zentra_erp, pg_catalog
AS $$
DECLARE
  r RECORD;
  j jsonb;
  v_codigo text := trim(coalesce(p_codigo, ''));
BEGIN
  IF v_codigo = '' THEN
    RETURN NULL;
  END IF;

  FOR r IN
    SELECT DISTINCT btrim(e.data_schema) AS ds
    FROM zentra_erp.empresas e
    WHERE e.data_schema IS NOT NULL
      AND btrim(e.data_schema) <> ''
      AND e.data_schema ~ '^erp_[a-z0-9_]+$'
  LOOP
    BEGIN
      EXECUTE format(
        $q$
        SELECT to_jsonb(x) FROM (
          SELECT sr.empresa_id, %L::text AS data_schema, sr.id AS revendedor_id
          FROM %I.sorteo_revendedores sr
          WHERE sr.sorteo_id = $1
            AND sr.activo = true
            AND lower(sr.codigo_referido) = lower($2)
          LIMIT 1
        ) x
        $q$,
        r.ds,
        r.ds
      )
      USING p_sorteo_id, v_codigo
      INTO j;
      IF j IS NOT NULL THEN
        RETURN j;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION zentra_erp.neura_resolve_sorteo_revendedor_public(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zentra_erp.neura_resolve_sorteo_revendedor_public(uuid, text) TO service_role;

-- -----------------------------------------------------------------------------
-- Teardown: borra schema tenant y limpia data_schema (sin borrar fila empresa)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION zentra_erp.neura_teardown_provision_failed(p_empresa_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = zentra_erp, pg_catalog
AS $$
DECLARE
  v_s text;
BEGIN
  SELECT data_schema INTO v_s
  FROM zentra_erp.empresas
  WHERE id = p_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_s IS NOT NULL AND btrim(v_s) <> '' AND v_s ~ '^erp_[a-z0-9_]+$' THEN
    EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', v_s);
  END IF;

  UPDATE zentra_erp.empresas
  SET data_schema = NULL
  WHERE id = p_empresa_id;

  PERFORM pg_notify('pgrst', 'reload schema');
END;
$$;

REVOKE ALL ON FUNCTION zentra_erp.neura_teardown_provision_failed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zentra_erp.neura_teardown_provision_failed(uuid) TO service_role;

-- -----------------------------------------------------------------------------
-- Al borrar empresa: eliminar schema tenant (evita huérfanos)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION zentra_erp.neura_trg_empresas_drop_tenant_schema()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = zentra_erp, pg_catalog
AS $$
DECLARE
  v_s text;
BEGIN
  v_s := OLD.data_schema;
  IF v_s IS NOT NULL AND btrim(v_s) <> '' AND v_s ~ '^erp_[a-z0-9_]+$' THEN
    EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', v_s);
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS tr_empresas_drop_tenant_schema ON zentra_erp.empresas;
CREATE TRIGGER tr_empresas_drop_tenant_schema
  BEFORE DELETE ON zentra_erp.empresas
  FOR EACH ROW
  EXECUTE FUNCTION zentra_erp.neura_trg_empresas_drop_tenant_schema();

-- -----------------------------------------------------------------------------
-- Provision: slug desde UI (nombre empresa) + clon completo
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION zentra_erp.neura_provision_empresa_data_schema(
  p_empresa_id uuid,
  p_schema_slug text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = zentra_erp, pg_catalog
AS $$
DECLARE
  v_existing text;
  v_slug text;
  v_schema text;
  v_nombre text;
BEGIN
  SELECT data_schema, nombre_empresa
  INTO v_existing, v_nombre
  FROM zentra_erp.empresas
  WHERE id = p_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'empresa no encontrada: %', p_empresa_id;
  END IF;

  IF v_existing IS NOT NULL AND btrim(v_existing) <> '' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'schema', v_existing,
      'status', 'already_provisioned'
    );
  END IF;

  v_slug := coalesce(nullif(trim(p_schema_slug), ''), v_nombre);
  v_schema := zentra_erp.neura_build_tenant_schema_name(v_slug, p_empresa_id);

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = v_schema) THEN
    RAISE EXCEPTION 'colisión de nombre de schema: %', v_schema;
  END IF;

  PERFORM zentra_erp.neura_clone_zentra_erp_to_tenant(v_schema);

  UPDATE zentra_erp.empresas
  SET data_schema = v_schema
  WHERE id = p_empresa_id;

  PERFORM pg_notify('pgrst', 'reload schema');

  RETURN jsonb_build_object(
    'ok', true,
    'schema', v_schema,
    'status', 'created'
  );
END;
$$;

REVOKE ALL ON FUNCTION zentra_erp.neura_provision_empresa_data_schema(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zentra_erp.neura_provision_empresa_data_schema(uuid, text) TO service_role;

COMMENT ON FUNCTION zentra_erp.neura_provision_empresa_data_schema(uuid, text) IS
  'Crea schema tenant erp_<slug>_<8hex> clonando estructura completa de zentra_erp (sin catálogo).';
