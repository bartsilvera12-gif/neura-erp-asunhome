-- Documentación en COMMENT para intención de reinicio / compra (WhatsApp sorteos).
-- Sin datos seed por tenant: activar por fila en chat_flows.flow_config.

COMMENT ON COLUMN public.chat_flows.flow_config IS
  'JSON por flujo: close_purchase_only_on_final_confirmation; '
  'restart_enabled (bool), restart_node_code (texto = node_code activo), '
  'restart_keywords / restart_strong_keywords (arrays de frases), '
  'restart_when_completed, restart_when_abandoned, do_not_restart_when_human_taken_over.';

DO $$
DECLARE
  sch text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'zentra_erp' AND table_name = 'chat_flows'
  ) THEN
    EXECUTE $c$
      COMMENT ON COLUMN zentra_erp.chat_flows.flow_config IS
      'JSON por flujo: close_purchase_only_on_final_confirmation; restart_enabled, restart_node_code, restart_keywords, restart_strong_keywords, restart_when_completed, restart_when_abandoned, do_not_restart_when_human_taken_over.'
    $c$;
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
      'COMMENT ON COLUMN %I.chat_flows.flow_config IS %L',
      sch,
      'JSON por flujo: close_purchase_only_on_final_confirmation; restart_enabled, restart_node_code, restart_keywords, restart_strong_keywords, restart_when_completed, restart_when_abandoned, do_not_restart_when_human_taken_over.'
    );
  END LOOP;
END $$;
