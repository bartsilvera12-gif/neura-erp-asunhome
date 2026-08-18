-- chat_queues / chat_agents en zentra_erp y esquemas tenant (er_*): mismas columnas Etapa 1.
-- Las migraciones anteriores solo tocaban public.chat_queues; PostgREST usa zentra_erp (o data_schema).

DO $$
DECLARE
  r RECORD;
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
    EXECUTE format(
      'ALTER TABLE %I.chat_queues ADD COLUMN IF NOT EXISTS descripcion text',
      r.sch
    );
    EXECUTE format(
      'ALTER TABLE %I.chat_queues ADD COLUMN IF NOT EXISTS distribution_strategy text',
      r.sch
    );
    EXECUTE format(
      'ALTER TABLE %I.chat_queues ADD COLUMN IF NOT EXISTS priority integer',
      r.sch
    );
    EXECUTE format(
      $f$
      UPDATE %I.chat_queues
      SET distribution_strategy = COALESCE(NULLIF(btrim(distribution_strategy), ''), 'least_load')
      WHERE distribution_strategy IS NULL OR btrim(distribution_strategy) = ''
      $f$,
      r.sch
    );
    EXECUTE format(
      'UPDATE %I.chat_queues SET priority = COALESCE(priority, 0) WHERE priority IS NULL',
      r.sch
    );
  END LOOP;

  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'chat_agents'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.chat_agents ADD COLUMN IF NOT EXISTS is_active boolean',
      r.sch
    );
    EXECUTE format(
      'ALTER TABLE %I.chat_agents ADD COLUMN IF NOT EXISTS receives_new_chats boolean',
      r.sch
    );
    EXECUTE format(
      'ALTER TABLE %I.chat_agents ADD COLUMN IF NOT EXISTS priority_in_queue integer',
      r.sch
    );
    EXECUTE format(
      'UPDATE %I.chat_agents SET is_active = COALESCE(is_active, true) WHERE is_active IS NULL',
      r.sch
    );
    EXECUTE format(
      'UPDATE %I.chat_agents SET receives_new_chats = COALESCE(receives_new_chats, true) WHERE receives_new_chats IS NULL',
      r.sch
    );
    EXECUTE format(
      'UPDATE %I.chat_agents SET priority_in_queue = COALESCE(priority_in_queue, 0) WHERE priority_in_queue IS NULL',
      r.sch
    );
    EXECUTE format(
      'ALTER TABLE %I.chat_agents ALTER COLUMN is_active SET DEFAULT true',
      r.sch
    );
    EXECUTE format(
      'ALTER TABLE %I.chat_agents ALTER COLUMN receives_new_chats SET DEFAULT true',
      r.sch
    );
    EXECUTE format(
      'ALTER TABLE %I.chat_agents ALTER COLUMN priority_in_queue SET DEFAULT 0',
      r.sch
    );
  END LOOP;
END;
$$;
