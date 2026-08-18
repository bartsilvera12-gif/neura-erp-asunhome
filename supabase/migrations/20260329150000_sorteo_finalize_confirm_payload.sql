-- Botones de confirmación en flujos con sorteo: agregar señal de cierre de compra si falta.
-- Evita depender de configuración manual por empresa para el patrón Confirmacion_de_datos / confirmado.

UPDATE public.chat_flow_options o
SET option_payload = COALESCE(o.option_payload, '{}'::jsonb)
  || jsonb_build_object('confirmar_orden_sorteo', true)
FROM public.chat_flow_nodes n
JOIN public.chat_flows f ON f.empresa_id = n.empresa_id AND f.flow_code = n.flow_code
WHERE o.node_id = n.id
  AND n.node_code = 'Confirmacion_de_datos'
  AND o.meta_button_id = 'confirmado'
  AND f.sorteo_id IS NOT NULL
  AND f.channel = 'whatsapp'
  AND NOT (
    COALESCE((o.option_payload->>'confirmar_orden_sorteo')::text, '') IN ('true', '1')
    OR COALESCE((o.option_payload->>'finalize_sorteo_order')::text, '') IN ('true', '1')
    OR COALESCE((o.option_payload->>'cerrar_compra_sorteo')::text, '') IN ('true', '1')
  );
