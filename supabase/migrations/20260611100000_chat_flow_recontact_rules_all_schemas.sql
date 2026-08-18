-- =============================================================================
-- Automatizaciones de recontacto (FASE 1): configuración por flujo.
-- Tablas en el mismo schema que chat_flows (public, zentra_erp, er_*, erp_*).
-- =============================================================================

DO $$
DECLARE
  sch text;
BEGIN
  FOR sch IN
    SELECT DISTINCT n.nspname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'chat_flows'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
    ORDER BY 1
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c2
      JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
      WHERE n2.nspname = sch AND c2.relname = 'chat_flow_recontact_rules' AND c2.relkind = 'r'
    ) THEN
      EXECUTE format($fmt$
        CREATE TABLE %I.chat_flow_recontact_rules (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id uuid NOT NULL,
          flow_code text NOT NULL,
          nombre text NOT NULL,
          descripcion text,
          activo boolean NOT NULL DEFAULT false,
          prioridad integer NOT NULL DEFAULT 100,
          included_node_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
          excluded_node_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
          idle_after_seconds integer NOT NULL DEFAULT 3600,
          max_attempts integer NOT NULL DEFAULT 1,
          cooldown_seconds integer NOT NULL DEFAULT 86400,
          schedule_config jsonb NOT NULL DEFAULT '{}'::jsonb,
          guard_config jsonb NOT NULL DEFAULT '{}'::jsonb,
          message_config jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT cfr_rules_idle_min CHECK (idle_after_seconds >= 60),
          CONSTRAINT cfr_rules_max_attempts CHECK (max_attempts >= 1),
          CONSTRAINT cfr_rules_cooldown_min CHECK (cooldown_seconds >= 60),
          CONSTRAINT cfr_rules_flow_fk FOREIGN KEY (empresa_id, flow_code)
            REFERENCES %I.chat_flows (empresa_id, flow_code) ON DELETE CASCADE
        )
      $fmt$, sch, sch);

      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_cfr_rules_empresa_flow ON %I.chat_flow_recontact_rules (empresa_id, flow_code)',
        sch
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_cfr_rules_flow_prio ON %I.chat_flow_recontact_rules (flow_code, prioridad)',
        sch
      );

      EXECUTE format($fmt$
        DROP TRIGGER IF EXISTS tr_cfr_rules_updated ON %I.chat_flow_recontact_rules;
        CREATE TRIGGER tr_cfr_rules_updated
          BEFORE UPDATE ON %I.chat_flow_recontact_rules
          FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
      $fmt$, sch, sch);

      EXECUTE format('ALTER TABLE %I.chat_flow_recontact_rules ENABLE ROW LEVEL SECURITY', sch);

      EXECUTE format($fmt$
        DROP POLICY IF EXISTS chat_flow_recontact_rules_select ON %I.chat_flow_recontact_rules;
        CREATE POLICY chat_flow_recontact_rules_select ON %I.chat_flow_recontact_rules FOR SELECT
          USING (public.puede_acceder_empresa(empresa_id))
      $fmt$, sch, sch);
      EXECUTE format($fmt$
        DROP POLICY IF EXISTS chat_flow_recontact_rules_insert ON %I.chat_flow_recontact_rules;
        CREATE POLICY chat_flow_recontact_rules_insert ON %I.chat_flow_recontact_rules FOR INSERT
          WITH CHECK (public.puede_acceder_empresa(empresa_id))
      $fmt$, sch, sch);
      EXECUTE format($fmt$
        DROP POLICY IF EXISTS chat_flow_recontact_rules_update ON %I.chat_flow_recontact_rules;
        CREATE POLICY chat_flow_recontact_rules_update ON %I.chat_flow_recontact_rules FOR UPDATE
          USING (public.puede_acceder_empresa(empresa_id))
          WITH CHECK (public.puede_acceder_empresa(empresa_id))
      $fmt$, sch, sch);
      EXECUTE format($fmt$
        DROP POLICY IF EXISTS chat_flow_recontact_rules_delete ON %I.chat_flow_recontact_rules;
        CREATE POLICY chat_flow_recontact_rules_delete ON %I.chat_flow_recontact_rules FOR DELETE
          USING (public.puede_acceder_empresa(empresa_id))
      $fmt$, sch, sch);

      EXECUTE format(
        'COMMENT ON TABLE %I.chat_flow_recontact_rules IS %L',
        sch,
        'Reglas declarativas de recontacto por flujo (FASE 1: solo configuración; sin envío automático).'
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_class c3
      JOIN pg_namespace n3 ON n3.oid = c3.relnamespace
      WHERE n3.nspname = sch AND c3.relname = 'chat_flow_recontact_runs' AND c3.relkind = 'r'
    ) THEN
      EXECUTE format($fmt$
        CREATE TABLE %I.chat_flow_recontact_runs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id uuid NOT NULL,
          rule_id uuid NOT NULL REFERENCES %I.chat_flow_recontact_rules(id) ON DELETE CASCADE,
          flow_code text NOT NULL,
          conversation_id uuid,
          flow_session_id uuid,
          decision text NOT NULL,
          skip_reason text,
          attempt_no integer,
          correlation_id text,
          payload_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      $fmt$, sch, sch);

      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_cfr_runs_rule_created ON %I.chat_flow_recontact_runs (rule_id, created_at DESC)',
        sch
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_cfr_runs_empresa_created ON %I.chat_flow_recontact_runs (empresa_id, created_at DESC)',
        sch
      );

      EXECUTE format('ALTER TABLE %I.chat_flow_recontact_runs ENABLE ROW LEVEL SECURITY', sch);

      EXECUTE format($fmt$
        DROP POLICY IF EXISTS chat_flow_recontact_runs_select ON %I.chat_flow_recontact_runs;
        CREATE POLICY chat_flow_recontact_runs_select ON %I.chat_flow_recontact_runs FOR SELECT
          USING (public.puede_acceder_empresa(empresa_id))
      $fmt$, sch, sch);
      EXECUTE format($fmt$
        DROP POLICY IF EXISTS chat_flow_recontact_runs_insert ON %I.chat_flow_recontact_runs;
        CREATE POLICY chat_flow_recontact_runs_insert ON %I.chat_flow_recontact_runs FOR INSERT
          WITH CHECK (public.puede_acceder_empresa(empresa_id))
      $fmt$, sch, sch);
      EXECUTE format($fmt$
        DROP POLICY IF EXISTS chat_flow_recontact_runs_update ON %I.chat_flow_recontact_runs;
        CREATE POLICY chat_flow_recontact_runs_update ON %I.chat_flow_recontact_runs FOR UPDATE
          USING (public.puede_acceder_empresa(empresa_id))
          WITH CHECK (public.puede_acceder_empresa(empresa_id))
      $fmt$, sch, sch);
      EXECUTE format($fmt$
        DROP POLICY IF EXISTS chat_flow_recontact_runs_delete ON %I.chat_flow_recontact_runs;
        CREATE POLICY chat_flow_recontact_runs_delete ON %I.chat_flow_recontact_runs FOR DELETE
          USING (public.puede_acceder_empresa(empresa_id))
      $fmt$, sch, sch);

      EXECUTE format(
        'COMMENT ON TABLE %I.chat_flow_recontact_runs IS %L',
        sch,
        'Auditoría / ejecución futura de recontactos (FASE 1: tabla preparada; sin motor automático).'
      );
    END IF;
  END LOOP;
END $$;
