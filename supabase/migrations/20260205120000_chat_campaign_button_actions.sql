-- =============================================================================
-- Acciones configurables por botón quick reply de plantilla (campañas WhatsApp).
-- Tabla en el mismo schema tenant que chat_campaigns.
-- =============================================================================

DO $$
DECLARE
  sch text;
BEGIN
  FOR sch IN
    SELECT DISTINCT n.nspname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'chat_channels'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
    ORDER BY 1
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c2
      JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
      WHERE n2.nspname = sch AND c2.relname = 'chat_campaigns' AND c2.relkind = 'r'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_class c2
      JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
      WHERE n2.nspname = sch AND c2.relname = 'chat_campaign_button_actions' AND c2.relkind = 'r'
    ) THEN
      EXECUTE format(
        $f$
        CREATE TABLE %I.chat_campaign_button_actions (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id uuid NOT NULL,
          campaign_id uuid NOT NULL REFERENCES %I.chat_campaigns(id) ON DELETE CASCADE,
          button_id text NOT NULL,
          button_label text,
          action_type text NOT NULL
            CHECK (action_type IN ('none','start_flow','send_text')),
          flow_code text,
          start_node_code text,
          text_body text,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT uq_ccba_campaign_button UNIQUE (campaign_id, button_id),
          CONSTRAINT ccba_button_id_nonempty CHECK (length(trim(button_id)) > 0),
          CONSTRAINT ccba_start_flow_requires_flow
            CHECK (action_type <> 'start_flow' OR (flow_code IS NOT NULL AND length(trim(flow_code)) > 0)),
          CONSTRAINT ccba_send_text_requires_body
            CHECK (action_type <> 'send_text' OR (text_body IS NOT NULL AND length(trim(text_body)) > 0))
        )
        $f$,
        sch,
        sch
      );

      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_ccba_empresa_campaign ON %I.chat_campaign_button_actions (empresa_id, campaign_id)',
        sch
      );

      EXECUTE format(
        $f$
        DROP TRIGGER IF EXISTS tr_ccba_updated ON %I.chat_campaign_button_actions;
        CREATE TRIGGER tr_ccba_updated
          BEFORE UPDATE ON %I.chat_campaign_button_actions
          FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
        $f$,
        sch,
        sch
      );

      EXECUTE format('ALTER TABLE %I.chat_campaign_button_actions ENABLE ROW LEVEL SECURITY', sch);

      EXECUTE format(
        $f$
        DROP POLICY IF EXISTS chat_campaign_button_actions_select ON %I.chat_campaign_button_actions;
        CREATE POLICY chat_campaign_button_actions_select ON %I.chat_campaign_button_actions FOR SELECT
          USING (public.puede_acceder_empresa(empresa_id))
        $f$,
        sch,
        sch
      );
      EXECUTE format(
        $f$
        DROP POLICY IF EXISTS chat_campaign_button_actions_insert ON %I.chat_campaign_button_actions;
        CREATE POLICY chat_campaign_button_actions_insert ON %I.chat_campaign_button_actions FOR INSERT
          WITH CHECK (public.puede_acceder_empresa(empresa_id))
        $f$,
        sch,
        sch
      );
      EXECUTE format(
        $f$
        DROP POLICY IF EXISTS chat_campaign_button_actions_update ON %I.chat_campaign_button_actions;
        CREATE POLICY chat_campaign_button_actions_update ON %I.chat_campaign_button_actions FOR UPDATE
          USING (public.puede_acceder_empresa(empresa_id))
          WITH CHECK (public.puede_acceder_empresa(empresa_id))
        $f$,
        sch,
        sch
      );
      EXECUTE format(
        $f$
        DROP POLICY IF EXISTS chat_campaign_button_actions_delete ON %I.chat_campaign_button_actions;
        CREATE POLICY chat_campaign_button_actions_delete ON %I.chat_campaign_button_actions FOR DELETE
          USING (public.puede_acceder_empresa(empresa_id))
        $f$,
        sch,
        sch
      );
    END IF;
  END LOOP;
END $$;
