-- =============================================================================
-- Índice parcial para listados de monitoreo: sin asignar, abiertas/pendientes, por actividad
-- Esquemas: public, zentra_erp, er_*, erp_*
-- =============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
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
    -- %L evita el bug de comillas en format() (no usar ''open'' dentro del patrón).
    EXECUTE format(
      $f$
      CREATE INDEX IF NOT EXISTS idx_chat_conv_emp_unassigned_recent
      ON %I.chat_conversations (empresa_id, last_message_at DESC NULLS LAST)
      WHERE assigned_agent_id IS NULL AND status IN (%L, %L)
      $f$,
      r.sch,
      'open',
      'pending'
    );
  END LOOP;
END;
$$;
