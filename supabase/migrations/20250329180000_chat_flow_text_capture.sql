-- Captura de texto libre dentro del flujo conversacional

ALTER TABLE public.chat_flow_nodes
  ADD COLUMN IF NOT EXISTS save_as_field text,
  ADD COLUMN IF NOT EXISTS next_node_code text;

CREATE TABLE IF NOT EXISTS public.chat_flow_data (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  flow_code       text NOT NULL,
  field_name      text NOT NULL,
  field_value     text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_flow_data_conversation_field
  ON public.chat_flow_data(conversation_id, field_name);

CREATE INDEX IF NOT EXISTS idx_chat_flow_data_empresa_conversation
  ON public.chat_flow_data(empresa_id, conversation_id);

ALTER TABLE public.chat_flow_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_flow_data_select" ON public.chat_flow_data;
DROP POLICY IF EXISTS "chat_flow_data_insert" ON public.chat_flow_data;
DROP POLICY IF EXISTS "chat_flow_data_update" ON public.chat_flow_data;
DROP POLICY IF EXISTS "chat_flow_data_delete" ON public.chat_flow_data;

CREATE POLICY "chat_flow_data_select" ON public.chat_flow_data FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_flow_data_insert" ON public.chat_flow_data FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_flow_data_update" ON public.chat_flow_data FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_flow_data_delete" ON public.chat_flow_data FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

-- Ajuste de seed para ejemplo real: datos -> guarda nombre y avanza a cedula
WITH target_nodes AS (
  SELECT id, empresa_id, flow_code, node_code
  FROM public.chat_flow_nodes
  WHERE flow_code = 'sorteo_default'
)
UPDATE public.chat_flow_nodes n
SET save_as_field = 'nombre',
    next_node_code = 'cedula'
FROM target_nodes t
WHERE n.id = t.id
  AND t.node_code = 'datos';

INSERT INTO public.chat_flow_nodes (
  empresa_id, flow_code, node_code, message_text, node_type, is_active, save_as_field, next_node_code
)
SELECT
  n.empresa_id,
  n.flow_code,
  'cedula',
  'Envíame tu cédula',
  'text',
  true,
  'cedula',
  NULL
FROM public.chat_flow_nodes n
WHERE n.flow_code = 'sorteo_default'
GROUP BY n.empresa_id, n.flow_code
ON CONFLICT (empresa_id, flow_code, node_code) DO UPDATE
  SET message_text = EXCLUDED.message_text,
      node_type = EXCLUDED.node_type,
      is_active = true,
      save_as_field = EXCLUDED.save_as_field,
      next_node_code = EXCLUDED.next_node_code;

COMMENT ON TABLE public.chat_flow_data IS 'Datos capturados desde nodos text del flujo por conversación';
