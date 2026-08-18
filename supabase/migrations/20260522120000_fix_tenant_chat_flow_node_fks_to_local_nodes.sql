-- =============================================================================
-- Tenants er_* / erp_*: FK node_id → chat_flow_nodes debe apuntar al mismo schema.
-- Si quedó REFERENCES zentra_erp.chat_flow_nodes, INSERT de bloques/opciones falla:
-- insert or update on table "chat_flow_node_blocks" violates foreign key constraint
-- "chat_flow_node_blocks_node_id_fkey"
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
      AND cf.relname IN ('chat_flow_node_blocks', 'chat_flow_options')
      AND rt.relname = 'chat_flow_nodes'
  LOOP
    def0 := pg_get_constraintdef(r.coid, true);
    newdef := replace(replace(def0, 'REFERENCES "zentra_erp".', 'REFERENCES ' || quote_ident(r.schema_name) || '.'), 'REFERENCES zentra_erp.', 'REFERENCES ' || quote_ident(r.schema_name) || '.');
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
    RAISE NOTICE 'fix_chat_flow_node_fk: %.%.% → FK local chat_flow_nodes', r.schema_name, r.from_table, r.conname;
  END LOOP;
END;
$$;
