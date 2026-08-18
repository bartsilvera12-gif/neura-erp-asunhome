-- Motivo operativo cuando la conversación queda en cola sin agente (UI inbox / monitoreo).
-- Valores típicos: manual_queue | no_eligible_agent | NULL (asignada o no aplica).

DO $$
DECLARE
  sch text;
BEGIN
  FOR sch IN
    SELECT DISTINCT n.nspname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'chat_conversations'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.chat_conversations ADD COLUMN IF NOT EXISTS assignment_wait_code text',
      sch
    );
    EXECUTE format(
      'COMMENT ON COLUMN %I.chat_conversations.assignment_wait_code IS %L',
      sch,
      'UX: conversación en espera — manual_queue (cola manual), no_eligible_agent (sin agentes listos). NULL si hay agente o no aplica.'
    );
  END LOOP;
END $$;
