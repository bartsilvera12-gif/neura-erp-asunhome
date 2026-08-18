-- =============================================================================
-- Limpia active_flow_session_id cuando la sesión ya no está active o no coincide
-- con la conversación / flow_code (legado: completed, abandoned, restarted, etc.)
-- Esquemas: public, zentra_erp, tenant er_* / erp_*
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
    EXECUTE format(
      $sql$
      UPDATE %I.chat_conversations c
      SET active_flow_session_id = NULL,
          updated_at = now()
      WHERE c.active_flow_session_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM %I.chat_flow_sessions s
          WHERE s.id = c.active_flow_session_id
            AND s.empresa_id = c.empresa_id
            AND s.conversation_id = c.id
            AND btrim(coalesce(s.flow_code, '')) = btrim(coalesce(c.flow_code, ''))
            AND s.status = 'active'
        )
      $sql$,
      r.sch,
      r.sch
    );
  END LOOP;
END;
$$;
