-- Tracking entrega WhatsApp (YCloud webhooks): timestamps en destinatarios + estado en mensajes.
DO $$
DECLARE
  sch text;
BEGIN
  FOR sch IN
    SELECT DISTINCT n.nspname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'chat_campaign_recipients'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
    ORDER BY 1
  LOOP
    EXECUTE format('ALTER TABLE %I.chat_campaign_recipients ADD COLUMN IF NOT EXISTS delivered_at timestamptz', sch);
    EXECUTE format('ALTER TABLE %I.chat_campaign_recipients ADD COLUMN IF NOT EXISTS read_at timestamptz', sch);
  END LOOP;

  FOR sch IN
    SELECT DISTINCT n.nspname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'chat_messages'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
    ORDER BY 1
  LOOP
    EXECUTE format('ALTER TABLE %I.chat_messages ADD COLUMN IF NOT EXISTS whatsapp_delivery_status text', sch);
    EXECUTE format('ALTER TABLE %I.chat_messages ADD COLUMN IF NOT EXISTS whatsapp_delivered_at timestamptz', sch);
    EXECUTE format('ALTER TABLE %I.chat_messages ADD COLUMN IF NOT EXISTS whatsapp_read_at timestamptz', sch);
  END LOOP;
END $$;
