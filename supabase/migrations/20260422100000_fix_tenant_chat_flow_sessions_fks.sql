-- =============================================================================
-- chat_flow_sessions en schemas tenant er_* / erp_* :
-- conversation_id (y otros) pueden seguir referenciando zentra_erp.chat_conversations
-- mientras las conversaciones viven solo en el schema tenant → INSERT sesión falla,
-- sync/bootstrap no pueden asignar flow ni active_flow_session_id → todo cae a Inbox.
-- =============================================================================

DO $$
DECLARE
  r RECORD;
  newdef text;
  def0 text;
BEGIN
  FOR r IN
    SELECT
      tn.nspname::text AS schema_name,
      c.conname::text AS conname,
      c.oid AS coid,
      cf.relname::text AS from_table,
      rt.relname::text AS ref_table
    FROM pg_constraint c
    JOIN pg_class cf ON cf.oid = c.conrelid
    JOIN pg_namespace tn ON tn.oid = cf.relnamespace
    JOIN pg_class rt ON rt.oid = c.confrelid
    JOIN pg_namespace rn ON rn.oid = rt.relnamespace
    WHERE c.contype = 'f'
      AND (
        tn.nspname ~ '^er_[0-9a-f]{32}$'
        OR tn.nspname ~ '^erp_[a-zA-Z0-9_]+$'
      )
      AND rn.nspname = 'zentra_erp'
      AND cf.relname = 'chat_flow_sessions'
      AND rt.relname = 'chat_conversations'
  LOOP
    def0 := pg_get_constraintdef(r.coid, true);
    newdef := replace(
      replace(def0, 'REFERENCES "zentra_erp".', 'REFERENCES ' || quote_ident(r.schema_name) || '.'),
      'REFERENCES zentra_erp.',
      'REFERENCES ' || quote_ident(r.schema_name) || '.'
    );
    IF newdef = def0 THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE %I.chat_flow_sessions DROP CONSTRAINT %I', r.schema_name, r.conname);
    EXECUTE format('ALTER TABLE %I.chat_flow_sessions ADD CONSTRAINT %I %s', r.schema_name, r.conname, newdef);
  END LOOP;
END;
$$;
