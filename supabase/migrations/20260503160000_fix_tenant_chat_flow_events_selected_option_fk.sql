-- =============================================================================
-- Tenants er_* / erp_*: chat_flow_events.selected_option_id puede seguir
-- referenciando zentra_erp.chat_flow_options mientras las filas de opciones
-- viven en el schema tenant → INSERT con UUID válido en tenant falla FK.
-- Misma estrategia que 20260522120000 / 20260523100000.
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
      AND cf.relname = 'chat_flow_events'
      AND rt.relname = 'chat_flow_options'
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
    RAISE NOTICE 'fix_chat_flow_events_selected_option_fk: %.%.% → local chat_flow_options',
      r.schema_name,
      r.from_table,
      r.conname;
  END LOOP;
END;
$$;
