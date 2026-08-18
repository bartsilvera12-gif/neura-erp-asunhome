-- =============================================================================
-- Config JSON por flujo (chat_flows.flow_config), p. ej. cierre de compra sorteo
-- solo tras confirmación explícita del cliente.
-- Idempotente: ADD COLUMN IF NOT EXISTS en public, zentra_erp y esquemas tenant.
-- =============================================================================

ALTER TABLE public.chat_flows
  ADD COLUMN IF NOT EXISTS flow_config jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.chat_flows.flow_config IS
  'JSON por flujo (ej. close_purchase_only_on_final_confirmation).';

DO $$
DECLARE
  sch text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'zentra_erp' AND table_name = 'chat_flows'
  ) THEN
    EXECUTE 'ALTER TABLE zentra_erp.chat_flows ADD COLUMN IF NOT EXISTS flow_config jsonb NOT NULL DEFAULT ''{}''::jsonb';
    EXECUTE 'COMMENT ON COLUMN zentra_erp.chat_flows.flow_config IS ''JSON por flujo (ej. close_purchase_only_on_final_confirmation).''';
  END IF;

  FOR sch IN
    SELECT n.nspname
    FROM pg_namespace n
    JOIN pg_class c ON c.relnamespace = n.oid
    WHERE c.relkind = 'r'
      AND c.relname = 'chat_flows'
      AND (
        n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname ~ '^erp_[a-zA-Z0-9_]+$'
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.chat_flows ADD COLUMN IF NOT EXISTS flow_config jsonb NOT NULL DEFAULT %L::jsonb',
      sch,
      '{}'
    );
    EXECUTE format(
      'COMMENT ON COLUMN %I.chat_flows.flow_config IS %L',
      sch,
      'JSON por flujo (ej. close_purchase_only_on_final_confirmation).'
    );
  END LOOP;
END $$;

-- Papu Store (tenant): solo este flujo activa la política nueva.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_namespace WHERE nspname = 'erp_el_papu_store_5ad0bdda'
  ) THEN
    UPDATE erp_el_papu_store_5ad0bdda.chat_flows
    SET flow_config = jsonb_set(
      coalesce(flow_config, '{}'::jsonb),
      '{close_purchase_only_on_final_confirmation}',
      'true'::jsonb,
      true
    )
    WHERE empresa_id = '5ad0bdda-f94f-446c-9032-1fedf34e8479'::uuid
      AND flow_code = 'Papu_store';
  END IF;
END $$;
