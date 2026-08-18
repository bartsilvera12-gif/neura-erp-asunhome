-- =============================================================================
-- Campañas WhatsApp (MVP): tablas chat_campaign_* en cada schema con chat_channels
-- RLS: public.puede_acceder_empresa(empresa_id)
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
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c2
      JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
      WHERE n2.nspname = sch AND c2.relname = 'chat_campaign_templates' AND c2.relkind = 'r'
    ) THEN
      EXECUTE format(
        $f$
        CREATE TABLE %I.chat_campaign_templates (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id uuid NOT NULL,
          channel_id uuid NOT NULL REFERENCES %I.chat_channels(id) ON DELETE CASCADE,
          provider text NOT NULL CHECK (provider IN ('meta','ycloud')),
          provider_template_id text,
          name text NOT NULL,
          language text NOT NULL DEFAULT 'es',
          category text,
          status text NOT NULL DEFAULT 'unknown',
          components_json jsonb NOT NULL DEFAULT '[]'::jsonb,
          variable_schema_json jsonb NOT NULL DEFAULT '{}'::jsonb,
          provider_payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
          last_synced_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT chat_campaign_templates_name_trim CHECK (length(trim(name)) > 0)
        )
        $f$,
        sch,
        sch
      );

      EXECUTE format(
        'CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_campaign_templates_natural ON %I.chat_campaign_templates (empresa_id, channel_id, provider, name, language)',
        sch
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_chat_campaign_templates_ch_st ON %I.chat_campaign_templates (empresa_id, channel_id, status)',
        sch
      );

      EXECUTE format(
        $f$
        DROP TRIGGER IF EXISTS tr_chat_campaign_templates_updated ON %I.chat_campaign_templates;
        CREATE TRIGGER tr_chat_campaign_templates_updated
          BEFORE UPDATE ON %I.chat_campaign_templates
          FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
        $f$,
        sch,
        sch
      );

      EXECUTE format('ALTER TABLE %I.chat_campaign_templates ENABLE ROW LEVEL SECURITY', sch);

      EXECUTE format(
        $f$
        DROP POLICY IF EXISTS chat_campaign_templates_select ON %I.chat_campaign_templates;
        CREATE POLICY chat_campaign_templates_select ON %I.chat_campaign_templates FOR SELECT
          USING (public.puede_acceder_empresa(empresa_id))
        $f$,
        sch,
        sch
      );
      EXECUTE format(
        $f$
        DROP POLICY IF EXISTS chat_campaign_templates_insert ON %I.chat_campaign_templates;
        CREATE POLICY chat_campaign_templates_insert ON %I.chat_campaign_templates FOR INSERT
          WITH CHECK (public.puede_acceder_empresa(empresa_id))
        $f$,
        sch,
        sch
      );
      EXECUTE format(
        $f$
        DROP POLICY IF EXISTS chat_campaign_templates_update ON %I.chat_campaign_templates;
        CREATE POLICY chat_campaign_templates_update ON %I.chat_campaign_templates FOR UPDATE
          USING (public.puede_acceder_empresa(empresa_id))
          WITH CHECK (public.puede_acceder_empresa(empresa_id))
        $f$,
        sch,
        sch
      );
      EXECUTE format(
        $f$
        DROP POLICY IF EXISTS chat_campaign_templates_delete ON %I.chat_campaign_templates;
        CREATE POLICY chat_campaign_templates_delete ON %I.chat_campaign_templates FOR DELETE
          USING (public.puede_acceder_empresa(empresa_id))
        $f$,
        sch,
        sch
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_class c2
      JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
      WHERE n2.nspname = sch AND c2.relname = 'chat_campaigns' AND c2.relkind = 'r'
    ) THEN
      EXECUTE format(
        $f$
        CREATE TABLE %I.chat_campaigns (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id uuid NOT NULL,
          name text NOT NULL,
          channel_id uuid NOT NULL REFERENCES %I.chat_channels(id) ON DELETE CASCADE,
          queue_id uuid REFERENCES %I.chat_queues(id) ON DELETE SET NULL,
          provider text NOT NULL CHECK (provider IN ('meta','ycloud')),
          template_id uuid REFERENCES %I.chat_campaign_templates(id) ON DELETE SET NULL,
          template_name text NOT NULL,
          template_language text NOT NULL DEFAULT 'es',
          template_category text,
          template_components_json jsonb NOT NULL DEFAULT '[]'::jsonb,
          variable_mapping_json jsonb NOT NULL DEFAULT '{}'::jsonb,
          import_original_filename text,
          import_storage_bucket text,
          import_storage_path text,
          status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','sending','completed','failed','cancelled')),
          total_count integer NOT NULL DEFAULT 0,
          valid_count integer NOT NULL DEFAULT 0,
          invalid_count integer NOT NULL DEFAULT 0,
          pending_count integer NOT NULL DEFAULT 0,
          queued_count integer NOT NULL DEFAULT 0,
          sent_count integer NOT NULL DEFAULT 0,
          failed_count integer NOT NULL DEFAULT 0,
          replied_count integer NOT NULL DEFAULT 0,
          send_config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_by uuid,
          started_at timestamptz,
          completed_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT chat_campaigns_name_trim CHECK (length(trim(name)) > 0)
        )
        $f$,
        sch,
        sch,
        sch,
        sch
      );

      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_chat_campaigns_e_st_cr ON %I.chat_campaigns (empresa_id, status, created_at DESC)',
        sch
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_chat_campaigns_e_ch ON %I.chat_campaigns (empresa_id, channel_id)',
        sch
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_chat_campaigns_e_q ON %I.chat_campaigns (empresa_id, queue_id)',
        sch
      );

      EXECUTE format(
        $f$
        DROP TRIGGER IF EXISTS tr_chat_campaigns_updated ON %I.chat_campaigns;
        CREATE TRIGGER tr_chat_campaigns_updated
          BEFORE UPDATE ON %I.chat_campaigns
          FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
        $f$,
        sch,
        sch
      );

      EXECUTE format('ALTER TABLE %I.chat_campaigns ENABLE ROW LEVEL SECURITY', sch);

      EXECUTE format(
        $f$
        DROP POLICY IF EXISTS chat_campaigns_select ON %I.chat_campaigns;
        CREATE POLICY chat_campaigns_select ON %I.chat_campaigns FOR SELECT
          USING (public.puede_acceder_empresa(empresa_id))
        $f$,
        sch,
        sch
      );
      EXECUTE format(
        $f$
        DROP POLICY IF EXISTS chat_campaigns_insert ON %I.chat_campaigns;
        CREATE POLICY chat_campaigns_insert ON %I.chat_campaigns FOR INSERT
          WITH CHECK (public.puede_acceder_empresa(empresa_id))
        $f$,
        sch,
        sch
      );
      EXECUTE format(
        $f$
        DROP POLICY IF EXISTS chat_campaigns_update ON %I.chat_campaigns;
        CREATE POLICY chat_campaigns_update ON %I.chat_campaigns FOR UPDATE
          USING (public.puede_acceder_empresa(empresa_id))
          WITH CHECK (public.puede_acceder_empresa(empresa_id))
        $f$,
        sch,
        sch
      );
      EXECUTE format(
        $f$
        DROP POLICY IF EXISTS chat_campaigns_delete ON %I.chat_campaigns;
        CREATE POLICY chat_campaigns_delete ON %I.chat_campaigns FOR DELETE
          USING (public.puede_acceder_empresa(empresa_id))
        $f$,
        sch,
        sch
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_class c2
      JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
      WHERE n2.nspname = sch AND c2.relname = 'chat_campaign_recipients' AND c2.relkind = 'r'
    ) THEN
      EXECUTE format(
        $f$
        CREATE TABLE %I.chat_campaign_recipients (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id uuid NOT NULL,
          campaign_id uuid NOT NULL REFERENCES %I.chat_campaigns(id) ON DELETE CASCADE,
          row_number integer NOT NULL,
          phone_raw text,
          phone_e164 text NOT NULL,
          contact_id uuid,
          conversation_id uuid,
          row_payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
          mapped_variables_json jsonb NOT NULL DEFAULT '{}'::jsonb,
          status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','invalid','queued','sending','sent','failed','replied','skipped')),
          validation_error text,
          provider_message_id text,
          provider_payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
          last_status_raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
          error_code text,
          error_message text,
          queued_at timestamptz,
          sent_at timestamptz,
          failed_at timestamptz,
          first_reply_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
        $f$,
        sch,
        sch
      );

      EXECUTE format(
        'CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_campaign_recipients_phone ON %I.chat_campaign_recipients (campaign_id, phone_e164)',
        sch
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_chat_campaign_recipients_e_c_st ON %I.chat_campaign_recipients (empresa_id, campaign_id, status)',
        sch
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_chat_campaign_recipients_wamid ON %I.chat_campaign_recipients (provider_message_id)',
        sch
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_chat_campaign_recipients_conv ON %I.chat_campaign_recipients (conversation_id)',
        sch
      );

      EXECUTE format(
        $f$
        DROP TRIGGER IF EXISTS tr_chat_campaign_recipients_updated ON %I.chat_campaign_recipients;
        CREATE TRIGGER tr_chat_campaign_recipients_updated
          BEFORE UPDATE ON %I.chat_campaign_recipients
          FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
        $f$,
        sch,
        sch
      );

      EXECUTE format('ALTER TABLE %I.chat_campaign_recipients ENABLE ROW LEVEL SECURITY', sch);

      EXECUTE format(
        $f$
        DROP POLICY IF EXISTS chat_campaign_recipients_select ON %I.chat_campaign_recipients;
        CREATE POLICY chat_campaign_recipients_select ON %I.chat_campaign_recipients FOR SELECT
          USING (public.puede_acceder_empresa(empresa_id))
        $f$,
        sch,
        sch
      );
      EXECUTE format(
        $f$
        DROP POLICY IF EXISTS chat_campaign_recipients_insert ON %I.chat_campaign_recipients;
        CREATE POLICY chat_campaign_recipients_insert ON %I.chat_campaign_recipients FOR INSERT
          WITH CHECK (public.puede_acceder_empresa(empresa_id))
        $f$,
        sch,
        sch
      );
      EXECUTE format(
        $f$
        DROP POLICY IF EXISTS chat_campaign_recipients_update ON %I.chat_campaign_recipients;
        CREATE POLICY chat_campaign_recipients_update ON %I.chat_campaign_recipients FOR UPDATE
          USING (public.puede_acceder_empresa(empresa_id))
          WITH CHECK (public.puede_acceder_empresa(empresa_id))
        $f$,
        sch,
        sch
      );
      EXECUTE format(
        $f$
        DROP POLICY IF EXISTS chat_campaign_recipients_delete ON %I.chat_campaign_recipients;
        CREATE POLICY chat_campaign_recipients_delete ON %I.chat_campaign_recipients FOR DELETE
          USING (public.puede_acceder_empresa(empresa_id))
        $f$,
        sch,
        sch
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_class c2
      JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
      WHERE n2.nspname = sch AND c2.relname = 'chat_campaign_events' AND c2.relkind = 'r'
    ) THEN
      EXECUTE format(
        $f$
        CREATE TABLE %I.chat_campaign_events (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id uuid NOT NULL,
          campaign_id uuid NOT NULL REFERENCES %I.chat_campaigns(id) ON DELETE CASCADE,
          recipient_id uuid REFERENCES %I.chat_campaign_recipients(id) ON DELETE SET NULL,
          event_type text NOT NULL,
          event_payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now()
        )
        $f$,
        sch,
        sch,
        sch
      );

      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_chat_campaign_events_e_c_cr ON %I.chat_campaign_events (empresa_id, campaign_id, created_at DESC)',
        sch
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_chat_campaign_events_rec ON %I.chat_campaign_events (recipient_id)',
        sch
      );

      EXECUTE format('ALTER TABLE %I.chat_campaign_events ENABLE ROW LEVEL SECURITY', sch);

      EXECUTE format(
        $f$
        DROP POLICY IF EXISTS chat_campaign_events_select ON %I.chat_campaign_events;
        CREATE POLICY chat_campaign_events_select ON %I.chat_campaign_events FOR SELECT
          USING (public.puede_acceder_empresa(empresa_id))
        $f$,
        sch,
        sch
      );
      EXECUTE format(
        $f$
        DROP POLICY IF EXISTS chat_campaign_events_insert ON %I.chat_campaign_events;
        CREATE POLICY chat_campaign_events_insert ON %I.chat_campaign_events FOR INSERT
          WITH CHECK (public.puede_acceder_empresa(empresa_id))
        $f$,
        sch,
        sch
      );
      EXECUTE format(
        $f$
        DROP POLICY IF EXISTS chat_campaign_events_update ON %I.chat_campaign_events;
        CREATE POLICY chat_campaign_events_update ON %I.chat_campaign_events FOR UPDATE
          USING (public.puede_acceder_empresa(empresa_id))
          WITH CHECK (public.puede_acceder_empresa(empresa_id))
        $f$,
        sch,
        sch
      );
      EXECUTE format(
        $f$
        DROP POLICY IF EXISTS chat_campaign_events_delete ON %I.chat_campaign_events;
        CREATE POLICY chat_campaign_events_delete ON %I.chat_campaign_events FOR DELETE
          USING (public.puede_acceder_empresa(empresa_id))
        $f$,
        sch,
        sch
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_class c2
      JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
      WHERE n2.nspname = sch AND c2.relname = 'chat_campaign_jobs' AND c2.relkind = 'r'
    ) THEN
      EXECUTE format(
        $f$
        CREATE TABLE %I.chat_campaign_jobs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id uuid NOT NULL,
          campaign_id uuid NOT NULL REFERENCES %I.chat_campaigns(id) ON DELETE CASCADE,
          status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed')),
          batch_size integer NOT NULL DEFAULT 25,
          locked_at timestamptz,
          locked_by text,
          attempts integer NOT NULL DEFAULT 0,
          last_error text,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
        $f$,
        sch,
        sch
      );

      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_chat_campaign_jobs_e_st ON %I.chat_campaign_jobs (empresa_id, status, created_at)',
        sch
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_chat_campaign_jobs_c ON %I.chat_campaign_jobs (campaign_id)',
        sch
      );

      EXECUTE format(
        $f$
        DROP TRIGGER IF EXISTS tr_chat_campaign_jobs_updated ON %I.chat_campaign_jobs;
        CREATE TRIGGER tr_chat_campaign_jobs_updated
          BEFORE UPDATE ON %I.chat_campaign_jobs
          FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
        $f$,
        sch,
        sch
      );

      EXECUTE format('ALTER TABLE %I.chat_campaign_jobs ENABLE ROW LEVEL SECURITY', sch);

      EXECUTE format(
        $f$
        DROP POLICY IF EXISTS chat_campaign_jobs_select ON %I.chat_campaign_jobs;
        CREATE POLICY chat_campaign_jobs_select ON %I.chat_campaign_jobs FOR SELECT
          USING (public.puede_acceder_empresa(empresa_id))
        $f$,
        sch,
        sch
      );
      EXECUTE format(
        $f$
        DROP POLICY IF EXISTS chat_campaign_jobs_insert ON %I.chat_campaign_jobs;
        CREATE POLICY chat_campaign_jobs_insert ON %I.chat_campaign_jobs FOR INSERT
          WITH CHECK (public.puede_acceder_empresa(empresa_id))
        $f$,
        sch,
        sch
      );
      EXECUTE format(
        $f$
        DROP POLICY IF EXISTS chat_campaign_jobs_update ON %I.chat_campaign_jobs;
        CREATE POLICY chat_campaign_jobs_update ON %I.chat_campaign_jobs FOR UPDATE
          USING (public.puede_acceder_empresa(empresa_id))
          WITH CHECK (public.puede_acceder_empresa(empresa_id))
        $f$,
        sch,
        sch
      );
      EXECUTE format(
        $f$
        DROP POLICY IF EXISTS chat_campaign_jobs_delete ON %I.chat_campaign_jobs;
        CREATE POLICY chat_campaign_jobs_delete ON %I.chat_campaign_jobs FOR DELETE
          USING (public.puede_acceder_empresa(empresa_id))
        $f$,
        sch,
        sch
      );
    END IF;
  END LOOP;
END $$;

-- Catálogo de módulos (slug campanas)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'zentra_erp' AND table_name = 'modulos'
  ) THEN
    INSERT INTO zentra_erp.modulos (id, nombre, slug)
    SELECT gen_random_uuid(), 'Campañas WhatsApp', 'campanas'
    WHERE NOT EXISTS (SELECT 1 FROM zentra_erp.modulos WHERE slug = 'campanas');
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'modulos'
  ) THEN
    INSERT INTO public.modulos (id, nombre, slug)
    SELECT gen_random_uuid(), 'Campañas WhatsApp', 'campanas'
    WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE slug = 'campanas');
  END IF;
END $$;
