-- =============================================================================
-- Roles operativos omnicanal + supervisión por cola y por equipo
-- Esquemas: public, zentra_erp, tenant er_* / erp_* (donde exista chat_queues)
-- Backfill: usuarios con chat_agents → role agente (sin pisar filas existentes)
-- =============================================================================

DO $$
DECLARE
  r RECORD;
  pol text;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'chat_queues'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
  LOOP
    IF r.sch = 'public' THEN
      pol := 'public.puede_acceder_empresa(empresa_id)';
    ELSE
      pol := 'zentra_erp.puede_acceder_empresa(empresa_id)';
    END IF;

    -- -------------------------------------------------------------------------
    -- chat_empresa_operator_roles
    -- -------------------------------------------------------------------------
    EXECUTE format(
      $f$
      CREATE TABLE IF NOT EXISTS %I.chat_empresa_operator_roles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
        role text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chat_empresa_operator_roles_role_check
          CHECK (role IN ('admin', 'supervisor', 'agente')),
        CONSTRAINT chat_empresa_operator_roles_empresa_usuario_key UNIQUE (empresa_id, usuario_id)
      )
      $f$,
      r.sch
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_chat_empresa_operator_roles_empresa ON %I.chat_empresa_operator_roles (empresa_id)',
      r.sch
    );

    EXECUTE format(
      'DROP TRIGGER IF EXISTS tr_chat_empresa_operator_roles_updated ON %I.chat_empresa_operator_roles',
      r.sch
    );
    BEGIN
      EXECUTE format(
        'CREATE TRIGGER tr_chat_empresa_operator_roles_updated
         BEFORE UPDATE ON %I.chat_empresa_operator_roles
         FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
        r.sch
      );
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE 'chat_supervision: set_updated_at ausente, sin trigger en %.chat_empresa_operator_roles', r.sch;
    END;

    EXECUTE format('ALTER TABLE %I.chat_empresa_operator_roles ENABLE ROW LEVEL SECURITY', r.sch);
    EXECUTE format('DROP POLICY IF EXISTS chat_empresa_operator_roles_select ON %I.chat_empresa_operator_roles', r.sch);
    EXECUTE format('DROP POLICY IF EXISTS chat_empresa_operator_roles_insert ON %I.chat_empresa_operator_roles', r.sch);
    EXECUTE format('DROP POLICY IF EXISTS chat_empresa_operator_roles_update ON %I.chat_empresa_operator_roles', r.sch);
    EXECUTE format('DROP POLICY IF EXISTS chat_empresa_operator_roles_delete ON %I.chat_empresa_operator_roles', r.sch);
    EXECUTE format(
      'CREATE POLICY chat_empresa_operator_roles_select ON %I.chat_empresa_operator_roles FOR SELECT USING (%s)',
      r.sch,
      pol
    );
    EXECUTE format(
      'CREATE POLICY chat_empresa_operator_roles_insert ON %I.chat_empresa_operator_roles FOR INSERT WITH CHECK (%s)',
      r.sch,
      pol
    );
    EXECUTE format(
      'CREATE POLICY chat_empresa_operator_roles_update ON %I.chat_empresa_operator_roles FOR UPDATE USING (%s) WITH CHECK (%s)',
      r.sch,
      pol,
      pol
    );
    EXECUTE format(
      'CREATE POLICY chat_empresa_operator_roles_delete ON %I.chat_empresa_operator_roles FOR DELETE USING (%s)',
      r.sch,
      pol
    );

    -- -------------------------------------------------------------------------
    -- chat_queue_supervisors
    -- -------------------------------------------------------------------------
    EXECUTE format(
      $f$
      CREATE TABLE IF NOT EXISTS %I.chat_queue_supervisors (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        queue_id uuid NOT NULL REFERENCES %I.chat_queues(id) ON DELETE CASCADE,
        usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chat_queue_supervisors_queue_usuario_key UNIQUE (queue_id, usuario_id)
      )
      $f$,
      r.sch,
      r.sch
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_chat_queue_supervisors_empresa_usuario ON %I.chat_queue_supervisors (empresa_id, usuario_id)',
      r.sch
    );

    EXECUTE format('ALTER TABLE %I.chat_queue_supervisors ENABLE ROW LEVEL SECURITY', r.sch);
    EXECUTE format('DROP POLICY IF EXISTS chat_queue_supervisors_select ON %I.chat_queue_supervisors', r.sch);
    EXECUTE format('DROP POLICY IF EXISTS chat_queue_supervisors_insert ON %I.chat_queue_supervisors', r.sch);
    EXECUTE format('DROP POLICY IF EXISTS chat_queue_supervisors_update ON %I.chat_queue_supervisors', r.sch);
    EXECUTE format('DROP POLICY IF EXISTS chat_queue_supervisors_delete ON %I.chat_queue_supervisors', r.sch);
    EXECUTE format(
      'CREATE POLICY chat_queue_supervisors_select ON %I.chat_queue_supervisors FOR SELECT USING (%s)',
      r.sch,
      pol
    );
    EXECUTE format(
      'CREATE POLICY chat_queue_supervisors_insert ON %I.chat_queue_supervisors FOR INSERT WITH CHECK (%s)',
      r.sch,
      pol
    );
    EXECUTE format(
      'CREATE POLICY chat_queue_supervisors_update ON %I.chat_queue_supervisors FOR UPDATE USING (%s) WITH CHECK (%s)',
      r.sch,
      pol,
      pol
    );
    EXECUTE format(
      'CREATE POLICY chat_queue_supervisors_delete ON %I.chat_queue_supervisors FOR DELETE USING (%s)',
      r.sch,
      pol
    );

    -- -------------------------------------------------------------------------
    -- chat_supervisor_agents
    -- -------------------------------------------------------------------------
    EXECUTE format(
      $f$
      CREATE TABLE IF NOT EXISTS %I.chat_supervisor_agents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        supervisor_usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
        agent_usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chat_supervisor_agents_empresa_sup_agent_key
          UNIQUE (empresa_id, supervisor_usuario_id, agent_usuario_id),
        CONSTRAINT chat_supervisor_agents_no_self CHECK (supervisor_usuario_id <> agent_usuario_id)
      )
      $f$,
      r.sch
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_chat_supervisor_agents_supervisor ON %I.chat_supervisor_agents (empresa_id, supervisor_usuario_id)',
      r.sch
    );

    EXECUTE format('ALTER TABLE %I.chat_supervisor_agents ENABLE ROW LEVEL SECURITY', r.sch);
    EXECUTE format('DROP POLICY IF EXISTS chat_supervisor_agents_select ON %I.chat_supervisor_agents', r.sch);
    EXECUTE format('DROP POLICY IF EXISTS chat_supervisor_agents_insert ON %I.chat_supervisor_agents', r.sch);
    EXECUTE format('DROP POLICY IF EXISTS chat_supervisor_agents_update ON %I.chat_supervisor_agents', r.sch);
    EXECUTE format('DROP POLICY IF EXISTS chat_supervisor_agents_delete ON %I.chat_supervisor_agents', r.sch);
    EXECUTE format(
      'CREATE POLICY chat_supervisor_agents_select ON %I.chat_supervisor_agents FOR SELECT USING (%s)',
      r.sch,
      pol
    );
    EXECUTE format(
      'CREATE POLICY chat_supervisor_agents_insert ON %I.chat_supervisor_agents FOR INSERT WITH CHECK (%s)',
      r.sch,
      pol
    );
    EXECUTE format(
      'CREATE POLICY chat_supervisor_agents_update ON %I.chat_supervisor_agents FOR UPDATE USING (%s) WITH CHECK (%s)',
      r.sch,
      pol,
      pol
    );
    EXECUTE format(
      'CREATE POLICY chat_supervisor_agents_delete ON %I.chat_supervisor_agents FOR DELETE USING (%s)',
      r.sch,
      pol
    );

    -- -------------------------------------------------------------------------
    -- Backfill: agentes desde chat_agents (no sobrescribe admin/supervisor manual)
    -- -------------------------------------------------------------------------
    BEGIN
      EXECUTE format(
        $ins$
        INSERT INTO %I.chat_empresa_operator_roles (empresa_id, usuario_id, role)
        SELECT DISTINCT ca.empresa_id, ca.usuario_id, 'agente'::text
        FROM %I.chat_agents ca
        ON CONFLICT (empresa_id, usuario_id) DO NOTHING
        $ins$,
        r.sch,
        r.sch
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'chat_supervision: backfill agente omitido en %: %', r.sch, SQLERRM;
    END;
  END LOOP;
END;
$$;

-- =============================================================================
-- Ampliar neura_clone_omnicanal_schema para nuevas tablas en tenants er_*
-- =============================================================================
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
    'chat_comprobante_validaciones',
    'chat_empresa_operator_roles',
    'chat_queue_supervisors',
    'chat_supervisor_agents'
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
