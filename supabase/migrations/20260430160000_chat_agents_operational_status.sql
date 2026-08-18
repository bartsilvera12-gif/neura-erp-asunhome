-- Estado operativo omnicanal (call center): solo `ready` recibe autoasignación.
-- Esquemas: public, zentra_erp, tenant er_* / erp_* (donde exista chat_agents).

DO $$
DECLARE
  sch text;
BEGIN
  FOR sch IN
    SELECT DISTINCT n.nspname
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
      'ALTER TABLE %I.chat_agents ADD COLUMN IF NOT EXISTS operational_status text',
      sch
    );
    EXECUTE format(
      'UPDATE %I.chat_agents SET operational_status = ''ready''
       WHERE operational_status IS NULL OR operational_status NOT IN (''ready'', ''offline'')',
      sch
    );
    EXECUTE format(
      'ALTER TABLE %I.chat_agents ALTER COLUMN operational_status SET DEFAULT ''ready''',
      sch
    );
    EXECUTE format(
      'ALTER TABLE %I.chat_agents ALTER COLUMN operational_status SET NOT NULL',
      sch
    );
    EXECUTE format(
      'ALTER TABLE %I.chat_agents DROP CONSTRAINT IF EXISTS chat_agents_operational_status_check',
      sch
    );
    EXECUTE format(
      'ALTER TABLE %I.chat_agents ADD CONSTRAINT chat_agents_operational_status_check CHECK (operational_status IN (''ready'', ''offline''))',
      sch
    );
    EXECUTE format(
      'COMMENT ON COLUMN %I.chat_agents.operational_status IS %L',
      sch,
      'Call center: ready = puede recibir autoasignación; offline = no recibe chats nuevos.'
    );
  END LOOP;
END $$;
