-- =============================================================================
-- Tenants er_* / erp_*: chat_flow_data y chat_flow_events pueden seguir con
-- conversation_id (y flow_session_id) referenciando zentra_erp mientras la
-- conversación y la sesión viven solo en el schema tenant → INSERT falla:
--   chat_flow_data_conversation_id_fkey
--   chat_flow_events_conversation_id_fkey
-- Misma estrategia que 20260422100000 (chat_flow_sessions).
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
      AND cf.relname IN ('chat_flow_data', 'chat_flow_events')
      AND rt.relname IN ('chat_conversations', 'chat_flow_sessions')
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
    EXECUTE format(
      'ALTER TABLE %I.%I DROP CONSTRAINT %I',
      r.schema_name,
      r.from_table,
      r.conname
    );
    EXECUTE format(
      'ALTER TABLE %I.%I ADD CONSTRAINT %I %s',
      r.schema_name,
      r.from_table,
      r.conname,
      newdef
    );
    RAISE NOTICE 'fix_chat_flow_data_events_fk: %.%.% → local %',
      r.schema_name,
      r.from_table,
      r.conname,
      r.ref_table;
  END LOOP;
END;
$$;
