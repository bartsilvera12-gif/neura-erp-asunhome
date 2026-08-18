-- =============================================================================
-- Respuestas rápidas por canal (inbox omnicanal)
-- Tabla en cada esquema que tenga chat_channels (public, zentra_erp, tenants er_*)
-- RLS: misma política que chat_queue_channels (public.puede_acceder_empresa)
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
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c2
      JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
      WHERE n2.nspname = sch AND c2.relname = 'chat_channel_quick_replies' AND c2.relkind = 'r'
    ) THEN
      EXECUTE format(
        $f$
        CREATE TABLE %I.chat_channel_quick_replies (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id uuid NOT NULL,
          channel_id uuid NOT NULL REFERENCES %I.chat_channels(id) ON DELETE CASCADE,
          title text NOT NULL,
          body text NOT NULL,
          sort_order integer NOT NULL DEFAULT 0,
          is_active boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT chat_channel_quick_replies_title_trim CHECK (length(trim(title)) > 0),
          CONSTRAINT chat_channel_quick_replies_body_trim CHECK (length(trim(body)) > 0)
        )
        $f$,
        sch,
        sch
      );

      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_chat_channel_quick_replies_ch ON %I.chat_channel_quick_replies(channel_id, sort_order)',
        sch
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_chat_channel_quick_replies_e ON %I.chat_channel_quick_replies(empresa_id)',
        sch
      );

      EXECUTE format(
        $f$
        DROP TRIGGER IF EXISTS tr_chat_channel_quick_replies_updated ON %I.chat_channel_quick_replies;
        CREATE TRIGGER tr_chat_channel_quick_replies_updated
          BEFORE UPDATE ON %I.chat_channel_quick_replies
          FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
        $f$,
        sch,
        sch
      );

      EXECUTE format('ALTER TABLE %I.chat_channel_quick_replies ENABLE ROW LEVEL SECURITY', sch);

      EXECUTE format(
        $f$
        DROP POLICY IF EXISTS chat_channel_quick_replies_select ON %I.chat_channel_quick_replies;
        CREATE POLICY chat_channel_quick_replies_select ON %I.chat_channel_quick_replies FOR SELECT
          USING (public.puede_acceder_empresa(empresa_id))
        $f$,
        sch,
        sch
      );
      EXECUTE format(
        $f$
        DROP POLICY IF EXISTS chat_channel_quick_replies_insert ON %I.chat_channel_quick_replies;
        CREATE POLICY chat_channel_quick_replies_insert ON %I.chat_channel_quick_replies FOR INSERT
          WITH CHECK (public.puede_acceder_empresa(empresa_id))
        $f$,
        sch,
        sch
      );
      EXECUTE format(
        $f$
        DROP POLICY IF EXISTS chat_channel_quick_replies_update ON %I.chat_channel_quick_replies;
        CREATE POLICY chat_channel_quick_replies_update ON %I.chat_channel_quick_replies FOR UPDATE
          USING (public.puede_acceder_empresa(empresa_id))
          WITH CHECK (public.puede_acceder_empresa(empresa_id))
        $f$,
        sch,
        sch
      );
      EXECUTE format(
        $f$
        DROP POLICY IF EXISTS chat_channel_quick_replies_delete ON %I.chat_channel_quick_replies;
        CREATE POLICY chat_channel_quick_replies_delete ON %I.chat_channel_quick_replies FOR DELETE
          USING (public.puede_acceder_empresa(empresa_id))
        $f$,
        sch,
        sch
      );

      EXECUTE format(
        'COMMENT ON TABLE %I.chat_channel_quick_replies IS %L',
        sch,
        'Respuestas rápidas reutilizables por canal (inbox omnicanal)'
      );
    END IF;
  END LOOP;
END $$;
