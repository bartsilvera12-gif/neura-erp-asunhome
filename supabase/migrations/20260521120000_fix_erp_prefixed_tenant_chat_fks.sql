-- =============================================================================
-- Esquemas tenant con prefijo erp_* (p. ej. erp_el_papu_store_<hex>).
-- La migración 20260411190000 solo reescribe FKs cuando el namespace coincide con
-- ^er_[0-9a-f]{32}$ — los tenants erp_* quedaron con chat_conversations.channel_id
-- referenciando zentra_erp.chat_channels mientras el canal vivo está solo en el schema tenant,
-- lo que rompe INSERT en chat_conversations (FK hacia fila inexistente en zentra_erp).
--
-- Esta migración aplica la misma lógica para:
--   ^er_[0-9a-f]{32}$  OR  ^erp_[a-zA-Z0-9_]+$
-- Idempotente: si la FK ya apunta al tenant local, replace no cambia def y se omite.
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
      cf.relname::text AS from_table
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
      AND cf.relname = 'chat_conversations'
      AND rt.relname IN (
        'chat_channels',
        'chat_contacts',
        'chat_queues',
        'chat_agents',
        'chat_flow_sessions'
      )
  LOOP
    def0 := pg_get_constraintdef(r.coid, true);
    newdef := replace(replace(def0, 'REFERENCES "zentra_erp".', 'REFERENCES ' || quote_ident(r.schema_name) || '.'), 'REFERENCES zentra_erp.', 'REFERENCES ' || quote_ident(r.schema_name) || '.');
    IF newdef = def0 THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE %I.chat_conversations DROP CONSTRAINT %I', r.schema_name, r.conname);
    EXECUTE format('ALTER TABLE %I.chat_conversations ADD CONSTRAINT %I %s', r.schema_name, r.conname, newdef);
  END LOOP;

  FOR r IN
    SELECT
      tn.nspname::text AS schema_name,
      c.conname::text AS conname,
      c.oid AS coid,
      cf.relname::text AS from_table
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
      AND cf.relname = 'chat_messages'
      AND rt.relname = 'chat_conversations'
  LOOP
    def0 := pg_get_constraintdef(r.coid, true);
    newdef := replace(replace(def0, 'REFERENCES "zentra_erp".', 'REFERENCES ' || quote_ident(r.schema_name) || '.'), 'REFERENCES zentra_erp.', 'REFERENCES ' || quote_ident(r.schema_name) || '.');
    IF newdef = def0 THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE %I.chat_messages DROP CONSTRAINT %I', r.schema_name, r.conname);
    EXECUTE format('ALTER TABLE %I.chat_messages ADD CONSTRAINT %I %s', r.schema_name, r.conname, newdef);
  END LOOP;
END;
$$;
