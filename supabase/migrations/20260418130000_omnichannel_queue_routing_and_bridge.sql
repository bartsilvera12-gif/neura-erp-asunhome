-- Puente cola↔canales, columnas chat_channels Etapa 1 y routing_config en todos los esquemas con chat_queues.
-- Corrige errores PostgREST en zentra_erp / tenant (tabla/columnas ausentes).

DO $$
DECLARE
  sch text;
BEGIN
  FOR sch IN
    SELECT DISTINCT n.nspname
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
    -- routing_config: reglas operativas (jsonb)
    EXECUTE format(
      'ALTER TABLE %I.chat_queues ADD COLUMN IF NOT EXISTS routing_config jsonb NOT NULL DEFAULT ''{}''::jsonb',
      sch
    );

    -- chat_channels: columnas omnicanal Etapa 1
    IF EXISTS (
      SELECT 1 FROM pg_class c2
      JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
      WHERE n2.nspname = sch AND c2.relname = 'chat_channels' AND c2.relkind = 'r'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I.chat_channels ADD COLUMN IF NOT EXISTS connection_mode text',
        sch
      );
      EXECUTE format(
        'ALTER TABLE %I.chat_channels ADD COLUMN IF NOT EXISTS config_status text',
        sch
      );
      EXECUTE format(
        $f$
        UPDATE %I.chat_channels
        SET config_status = COALESCE(NULLIF(btrim(config_status), ''), 'incomplete')
        WHERE config_status IS NULL OR btrim(config_status) = ''
        $f$,
        sch
      );
    END IF;

    -- chat_queue_channels: tabla puente (requiere chat_channels en el mismo esquema)
    IF EXISTS (
      SELECT 1 FROM pg_class c3
      JOIN pg_namespace n3 ON n3.oid = c3.relnamespace
      WHERE n3.nspname = sch AND c3.relname = 'chat_channels' AND c3.relkind = 'r'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_class c4
      JOIN pg_namespace n4 ON n4.oid = c4.relnamespace
      WHERE n4.nspname = sch AND c4.relname = 'chat_queue_channels' AND c4.relkind = 'r'
    ) THEN
      EXECUTE format(
        $f$
        CREATE TABLE %I.chat_queue_channels (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id uuid NOT NULL,
          queue_id uuid NOT NULL REFERENCES %I.chat_queues(id) ON DELETE CASCADE,
          channel_id uuid NOT NULL REFERENCES %I.chat_channels(id) ON DELETE CASCADE,
          created_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT uq_chat_queue_channels_queue_channel UNIQUE (queue_id, channel_id)
        )
        $f$,
        sch,
        sch,
        sch
      );
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_cqc_q ON %I.chat_queue_channels(queue_id)', sch);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_cqc_ch ON %I.chat_queue_channels(channel_id)', sch);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_cqc_e ON %I.chat_queue_channels(empresa_id)', sch);
      EXECUTE format('COMMENT ON TABLE %I.chat_queue_channels IS %L', sch,
        'Canales atendidos por una cola; si está vacío puede usarse chat_queues.channel_type (legado)');

      EXECUTE format('ALTER TABLE %I.chat_queue_channels ENABLE ROW LEVEL SECURITY', sch);

      EXECUTE format(
        $f$
        DROP POLICY IF EXISTS chat_queue_channels_select ON %I.chat_queue_channels;
        CREATE POLICY chat_queue_channels_select ON %I.chat_queue_channels FOR SELECT
          USING (public.puede_acceder_empresa(empresa_id))
        $f$,
        sch,
        sch
      );
      EXECUTE format(
        $f$
        DROP POLICY IF EXISTS chat_queue_channels_insert ON %I.chat_queue_channels;
        CREATE POLICY chat_queue_channels_insert ON %I.chat_queue_channels FOR INSERT
          WITH CHECK (public.puede_acceder_empresa(empresa_id))
        $f$,
        sch,
        sch
      );
      EXECUTE format(
        $f$
        DROP POLICY IF EXISTS chat_queue_channels_update ON %I.chat_queue_channels;
        CREATE POLICY chat_queue_channels_update ON %I.chat_queue_channels FOR UPDATE
          USING (public.puede_acceder_empresa(empresa_id))
          WITH CHECK (public.puede_acceder_empresa(empresa_id))
        $f$,
        sch,
        sch
      );
      EXECUTE format(
        $f$
        DROP POLICY IF EXISTS chat_queue_channels_delete ON %I.chat_queue_channels;
        CREATE POLICY chat_queue_channels_delete ON %I.chat_queue_channels FOR DELETE
          USING (public.puede_acceder_empresa(empresa_id))
        $f$,
        sch,
        sch
      );

      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.chat_queue_channels TO postgres, anon, authenticated, service_role',
        sch
      );
    END IF;
  END LOOP;
END;
$$;
