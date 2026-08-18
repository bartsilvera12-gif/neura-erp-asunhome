-- =============================================================================
-- Esquema de datos por empresa (plantilla zentra_erp → er_<uuid sin guiones>).
-- Catálogo global: zentra_erp.empresas, usuarios, módulos.
-- Omnicanal operativo: tablas chat_* en el esquema de la empresa cuando data_schema IS NOT NULL.
-- =============================================================================

ALTER TABLE zentra_erp.empresas
  ADD COLUMN IF NOT EXISTS data_schema text;

CREATE UNIQUE INDEX IF NOT EXISTS empresas_data_schema_unique
  ON zentra_erp.empresas (data_schema)
  WHERE data_schema IS NOT NULL;

COMMENT ON COLUMN zentra_erp.empresas.data_schema IS
  'PostgreSQL schema para datos operativos (omnicanal/chat). NULL = usar zentra_erp como hasta ahora.';

-- Enrutamiento webhook Meta: phone_number_id → esquema + channel (sin escanear todos los schemas).
CREATE TABLE IF NOT EXISTS zentra_erp.omnichannel_routes (
  meta_phone_number_id text PRIMARY KEY,
  empresa_id           uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
  channel_id           uuid NOT NULL,
  data_schema          text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_omnichannel_routes_empresa
  ON zentra_erp.omnichannel_routes (empresa_id);

COMMENT ON TABLE zentra_erp.omnichannel_routes IS
  'Índice en zentra_erp para resolver Meta phone_number_id → schema tenant + channel_id.';

ALTER TABLE zentra_erp.omnichannel_routes ENABLE ROW LEVEL SECURITY;

-- Solo service_role (webhooks / API servidor); usuarios no consultan esta tabla vía PostgREST.
DROP POLICY IF EXISTS "omnichannel_routes_service_all" ON zentra_erp.omnichannel_routes;
CREATE POLICY "omnichannel_routes_service_all"
  ON zentra_erp.omnichannel_routes FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE zentra_erp.omnichannel_routes FROM anon, authenticated;
GRANT ALL ON TABLE zentra_erp.omnichannel_routes TO service_role;

DROP TRIGGER IF EXISTS tr_omnichannel_routes_updated ON zentra_erp.omnichannel_routes;
CREATE TRIGGER tr_omnichannel_routes_updated
  BEFORE UPDATE ON zentra_erp.omnichannel_routes
  FOR EACH ROW EXECUTE FUNCTION zentra_erp.set_updated_at();

-- -----------------------------------------------------------------------------
-- Helper: reescribe calificadores zentra_erp.<tabla_omnicanal> → <tgt>.<tabla>
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION zentra_erp._neura_rewrite_schema_in_expr(p_expr text, p_tgt text, p_tables text[])
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
    r := replace(r, 'zentra_erp.' || t, p_tgt || '.' || t);
  END LOOP;
  RETURN r;
END;
$$;

-- -----------------------------------------------------------------------------
-- Clona subconjunto omnicanal desde zentra_erp hacia p_target_schema (vacío).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION zentra_erp.neura_clone_omnicanal_schema(p_target_schema text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = zentra_erp, pg_catalog
AS $$
DECLARE
  v_tables text[] := ARRAY[
    'chat_flows',
    'chat_queues',
    'chat_channels',
    'chat_agents',
    'chat_contacts',
    'chat_conversations',
    'chat_flow_nodes',
    'chat_flow_options',
    'chat_messages',
    'chat_flow_sessions',
    'chat_flow_data',
    'chat_flow_events',
    'chat_flow_node_blocks',
    'chat_comprobante_validaciones'
  ];
  r RECORD;
  def text;
  idef text;
  tdef text;
  qual text;
  chk text;
  roles_clause text;
  tbl text;
BEGIN
  IF p_target_schema !~ '^er_[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'schema inválido (se espera er_ + uuid sin guiones): %', p_target_schema;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = p_target_schema) THEN
    RAISE EXCEPTION 'el esquema % ya existe', p_target_schema;
  END IF;

  EXECUTE format('CREATE SCHEMA %I', p_target_schema);

  EXECUTE format(
    'GRANT USAGE ON SCHEMA %I TO postgres, anon, authenticated, service_role',
    p_target_schema
  );

  -- Tablas vacías (estructura sin constraints)
  FOREACH tbl IN ARRAY v_tables
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'zentra_erp' AND c.relname = tbl AND c.relkind = 'r'
    ) THEN
      RAISE NOTICE 'neura_clone: tabla zentra_erp.% ausente, se omite', tbl;
      CONTINUE;
    END IF;
    EXECUTE format(
      'CREATE TABLE %I.%I (LIKE zentra_erp.%I INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING IDENTITY INCLUDING STATISTICS INCLUDING STORAGE INCLUDING COMMENTS EXCLUDING CONSTRAINTS EXCLUDING INDEXES)',
      p_target_schema,
      tbl,
      tbl
    );
  END LOOP;

  -- PK, UNIQUE, CHECK (no FK aún)
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
    def := zentra_erp._neura_rewrite_schema_in_expr(def, quote_ident(p_target_schema), v_tables);
    BEGIN
      EXECUTE format(
        'ALTER TABLE %I.%I ADD CONSTRAINT %I %s',
        p_target_schema,
        r.relname,
        r.conname,
        def
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'neura_clone: constraint %.% omitido: %', r.relname, r.conname, SQLERRM;
    END;
  END LOOP;

  -- Índices secundarios (no PK/único interno)
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
    idef := zentra_erp._neura_rewrite_schema_in_expr(r.idef, quote_ident(p_target_schema), v_tables);
    BEGIN
      EXECUTE idef;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'neura_clone: índice omitido: %', SQLERRM;
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
    def := zentra_erp._neura_rewrite_schema_in_expr(def, quote_ident(p_target_schema), v_tables);
    BEGIN
      EXECUTE format(
        'ALTER TABLE %I.%I ADD CONSTRAINT %I %s',
        p_target_schema,
        r.from_table,
        r.conname,
        def
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'neura_clone: FK %.% omitido: %', r.from_table, r.conname, SQLERRM;
    END;
  END LOOP;

  -- Triggers (funciones siguen en zentra_erp: set_updated_at, set_chat_contact_phone_normalized, etc.)
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
    tdef := replace(tdef, ' ON zentra_erp.' || r.tablename || ' ', ' ON ' || quote_ident(p_target_schema) || '.' || r.tablename || ' ');
    tdef := replace(tdef, ' ON zentra_erp."' || r.tablename || '" ', ' ON ' || quote_ident(p_target_schema) || '."' || r.tablename || '" ');
    BEGIN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I.%I', r.tgname, p_target_schema, r.tablename);
      EXECUTE tdef;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'neura_clone: trigger % en % omitido: %', r.tgname, r.tablename, SQLERRM;
    END;
  END LOOP;

  -- RLS + policies (mantener zentra_erp.puede_acceder_empresa / es_super_admin / empresa_id_actual)
  FOREACH tbl IN ARRAY v_tables
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = p_target_schema AND c.relname = tbl AND c.relkind = 'r'
    ) THEN
      EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', p_target_schema, tbl);
    END IF;
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
      qual := zentra_erp._neura_rewrite_schema_in_expr(r.polqual, quote_ident(p_target_schema), v_tables);
      chk := zentra_erp._neura_rewrite_schema_in_expr(r.polwithcheck, quote_ident(p_target_schema), v_tables);

      IF r.roles IS NULL OR coalesce(cardinality(r.roles), 0) = 0 THEN
        roles_clause := '';
      ELSE
        roles_clause := ' TO ' || (SELECT string_agg(quote_ident(x), ', ') FROM unnest(r.roles) AS x);
      END IF;

      EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.polname, p_target_schema, r.tablename);

      IF r.cmd = 'r' THEN
        EXECUTE format(
          'CREATE POLICY %I ON %I.%I AS %s FOR SELECT%s USING (%s)',
          r.polname,
          p_target_schema,
          r.tablename,
          CASE WHEN r.permissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
          roles_clause,
          coalesce(qual, 'true')
        );
      ELSIF r.cmd = 'a' THEN
        EXECUTE format(
          'CREATE POLICY %I ON %I.%I AS %s FOR INSERT%s WITH CHECK (%s)',
          r.polname,
          p_target_schema,
          r.tablename,
          CASE WHEN r.permissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
          roles_clause,
          coalesce(chk, qual, 'true')
        );
      ELSIF r.cmd = 'w' THEN
        EXECUTE format(
          'CREATE POLICY %I ON %I.%I AS %s FOR UPDATE%s USING (%s) WITH CHECK (%s)',
          r.polname,
          p_target_schema,
          r.tablename,
          CASE WHEN r.permissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
          roles_clause,
          coalesce(qual, 'true'),
          coalesce(chk, qual, 'true')
        );
      ELSIF r.cmd = 'd' THEN
        EXECUTE format(
          'CREATE POLICY %I ON %I.%I AS %s FOR DELETE%s USING (%s)',
          r.polname,
          p_target_schema,
          r.tablename,
          CASE WHEN r.permissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
          roles_clause,
          coalesce(qual, 'true')
        );
      ELSIF r.cmd = '*' THEN
        EXECUTE format(
          'CREATE POLICY %I ON %I.%I AS %s FOR ALL%s USING (%s) WITH CHECK (%s)',
          r.polname,
          p_target_schema,
          r.tablename,
          CASE WHEN r.permissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
          roles_clause,
          coalesce(qual, 'true'),
          coalesce(chk, qual, 'true')
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'neura_clone: policy % en % omitido: %', r.polname, r.tablename, SQLERRM;
    END;
  END LOOP;

  -- Grants (alineado con bootstrap zentra_erp)
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

  -- Realtime (idempotente)
  BEGIN
    EXECUTE format(
      'ALTER PUBLICATION supabase_realtime ADD TABLE %I.chat_messages',
      p_target_schema
    );
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
  BEGIN
    EXECUTE format(
      'ALTER PUBLICATION supabase_realtime ADD TABLE %I.chat_conversations',
      p_target_schema
    );
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;

  PERFORM pg_notify('pgrst', 'reload schema');
END;
$$;

REVOKE ALL ON FUNCTION zentra_erp.neura_clone_omnicanal_schema(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zentra_erp.neura_clone_omnicanal_schema(text) TO service_role;

-- -----------------------------------------------------------------------------
-- Provisiona esquema y actualiza empresas.data_schema (idempotente si ya existe).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION zentra_erp.neura_provision_empresa_data_schema(p_empresa_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = zentra_erp, pg_catalog
AS $$
DECLARE
  v_schema text;
  v_existing text;
BEGIN
  SELECT data_schema INTO v_existing
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

  v_schema := 'er_' || replace(p_empresa_id::text, '-', '');

  PERFORM zentra_erp.neura_clone_omnicanal_schema(v_schema);

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

REVOKE ALL ON FUNCTION zentra_erp.neura_provision_empresa_data_schema(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zentra_erp.neura_provision_empresa_data_schema(uuid) TO service_role;
