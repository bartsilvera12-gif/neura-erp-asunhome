-- Completa flujo sorteo_default luego de "cedula"
WITH base_empresas AS (
  SELECT DISTINCT empresa_id
  FROM public.chat_flow_nodes
  WHERE flow_code = 'sorteo_default'
)
UPDATE public.chat_flow_nodes n
SET save_as_field = 'cedula',
    next_node_code = 'ciudad',
    is_active = true
FROM base_empresas be
WHERE n.empresa_id = be.empresa_id
  AND n.flow_code = 'sorteo_default'
  AND n.node_code = 'cedula';

WITH base_empresas AS (
  SELECT DISTINCT empresa_id
  FROM public.chat_flow_nodes
  WHERE flow_code = 'sorteo_default'
)
INSERT INTO public.chat_flow_nodes (
  empresa_id,
  flow_code,
  node_code,
  message_text,
  node_type,
  is_active,
  save_as_field,
  next_node_code
)
SELECT
  be.empresa_id,
  'sorteo_default',
  v.node_code,
  v.message_text,
  v.node_type,
  true,
  v.save_as_field,
  v.next_node_code
FROM base_empresas be
CROSS JOIN (
  VALUES
    ('ciudad', 'Envíame tu ciudad', 'text', 'ciudad', 'comprobante'),
    ('comprobante', 'Adjunta una imagen de tu comprobante de pago', 'image_input', 'comprobante', 'confirmacion'),
    ('confirmacion', 'Comprobante recibido correctamente. Un asesor validará tu pago y continuará el proceso.', 'human', NULL, NULL)
) AS v(node_code, message_text, node_type, save_as_field, next_node_code)
ON CONFLICT (empresa_id, flow_code, node_code) DO UPDATE
  SET message_text = EXCLUDED.message_text,
      node_type = EXCLUDED.node_type,
      is_active = true,
      save_as_field = EXCLUDED.save_as_field,
      next_node_code = EXCLUDED.next_node_code;
