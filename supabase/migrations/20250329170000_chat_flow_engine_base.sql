-- =============================================================================
-- Motor base de flujo conversacional WhatsApp (sin UI final ni webhook logic)
-- =============================================================================

-- 1) Extender chat_conversations con estado de flujo
ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS flow_code text,
  ADD COLUMN IF NOT EXISTS flow_current_node text,
  ADD COLUMN IF NOT EXISTS flow_status text NOT NULL DEFAULT 'bot',
  ADD COLUMN IF NOT EXISTS human_taken_over boolean NOT NULL DEFAULT false;

-- 2) Tabla de nodos del flujo
CREATE TABLE IF NOT EXISTS public.chat_flow_nodes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  flow_code     text NOT NULL,
  node_code     text NOT NULL,
  message_text  text,
  node_type     text NOT NULL
    CHECK (node_type IN ('buttons', 'list', 'text', 'image_input', 'human', 'end')),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, flow_code, node_code)
);

-- 3) Tabla de opciones por nodo
CREATE TABLE IF NOT EXISTS public.chat_flow_options (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id        uuid NOT NULL REFERENCES public.chat_flow_nodes(id) ON DELETE CASCADE,
  label          text NOT NULL,
  option_value   text NOT NULL,
  meta_button_id text NOT NULL,
  next_node_code text,
  sort_order     int NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (node_id, meta_button_id)
);

-- 4) Tabla de eventos de flujo (auditoría)
CREATE TABLE IF NOT EXISTS public.chat_flow_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  conversation_id    uuid NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  flow_code          text,
  node_code          text,
  event_type         text NOT NULL,
  selected_option_id uuid REFERENCES public.chat_flow_options(id) ON DELETE SET NULL,
  meta_button_id     text,
  payload            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- 5) RLS con patrón multiempresa
ALTER TABLE public.chat_flow_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_flow_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_flow_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_flow_nodes_select" ON public.chat_flow_nodes;
DROP POLICY IF EXISTS "chat_flow_nodes_insert" ON public.chat_flow_nodes;
DROP POLICY IF EXISTS "chat_flow_nodes_update" ON public.chat_flow_nodes;
DROP POLICY IF EXISTS "chat_flow_nodes_delete" ON public.chat_flow_nodes;

CREATE POLICY "chat_flow_nodes_select" ON public.chat_flow_nodes FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_flow_nodes_insert" ON public.chat_flow_nodes FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_flow_nodes_update" ON public.chat_flow_nodes FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_flow_nodes_delete" ON public.chat_flow_nodes FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

DROP POLICY IF EXISTS "chat_flow_options_select" ON public.chat_flow_options;
DROP POLICY IF EXISTS "chat_flow_options_insert" ON public.chat_flow_options;
DROP POLICY IF EXISTS "chat_flow_options_update" ON public.chat_flow_options;
DROP POLICY IF EXISTS "chat_flow_options_delete" ON public.chat_flow_options;

CREATE POLICY "chat_flow_options_select" ON public.chat_flow_options FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.chat_flow_nodes n
      WHERE n.id = chat_flow_options.node_id
        AND public.puede_acceder_empresa(n.empresa_id)
    )
  );
CREATE POLICY "chat_flow_options_insert" ON public.chat_flow_options FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.chat_flow_nodes n
      WHERE n.id = chat_flow_options.node_id
        AND public.puede_acceder_empresa(n.empresa_id)
    )
  );
CREATE POLICY "chat_flow_options_update" ON public.chat_flow_options FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.chat_flow_nodes n
      WHERE n.id = chat_flow_options.node_id
        AND public.puede_acceder_empresa(n.empresa_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.chat_flow_nodes n
      WHERE n.id = chat_flow_options.node_id
        AND public.puede_acceder_empresa(n.empresa_id)
    )
  );
CREATE POLICY "chat_flow_options_delete" ON public.chat_flow_options FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.chat_flow_nodes n
      WHERE n.id = chat_flow_options.node_id
        AND public.puede_acceder_empresa(n.empresa_id)
    )
  );

DROP POLICY IF EXISTS "chat_flow_events_select" ON public.chat_flow_events;
DROP POLICY IF EXISTS "chat_flow_events_insert" ON public.chat_flow_events;
DROP POLICY IF EXISTS "chat_flow_events_update" ON public.chat_flow_events;
DROP POLICY IF EXISTS "chat_flow_events_delete" ON public.chat_flow_events;

CREATE POLICY "chat_flow_events_select" ON public.chat_flow_events FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_flow_events_insert" ON public.chat_flow_events FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_flow_events_update" ON public.chat_flow_events FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_flow_events_delete" ON public.chat_flow_events FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

-- 6) Índices útiles
CREATE INDEX IF NOT EXISTS idx_chat_flow_nodes_empresa_flow
  ON public.chat_flow_nodes(empresa_id, flow_code);

CREATE INDEX IF NOT EXISTS idx_chat_flow_options_node_sort
  ON public.chat_flow_options(node_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_chat_flow_events_conv_created_desc
  ON public.chat_flow_events(conversation_id, created_at DESC);

-- 7) Seed inicial de ejemplo: flow_code = 'sorteo_default'
WITH base_empresas AS (
  SELECT e.id AS empresa_id
  FROM public.empresas e
),
seed_nodes AS (
  INSERT INTO public.chat_flow_nodes (empresa_id, flow_code, node_code, message_text, node_type, is_active)
  SELECT
    be.empresa_id,
    'sorteo_default',
    v.node_code,
    v.message_text,
    v.node_type,
    true
  FROM base_empresas be
  CROSS JOIN (
    VALUES
      ('inicio', 'Hola 👋 ¿Qué deseas hacer?', 'buttons'),
      ('precio', 'La entrada cuesta Gs. X. ¿Cuántas quieres?', 'buttons'),
      ('humano', 'Perfecto, te comunicaremos con un asesor.', 'human'),
      ('datos', 'Perfecto. Envíame tu nombre completo.', 'text')
  ) AS v(node_code, message_text, node_type)
  ON CONFLICT (empresa_id, flow_code, node_code) DO UPDATE
    SET message_text = EXCLUDED.message_text,
        node_type = EXCLUDED.node_type,
        is_active = true
  RETURNING id, empresa_id, flow_code, node_code
),
all_seed_nodes AS (
  SELECT n.id, n.empresa_id, n.flow_code, n.node_code
  FROM public.chat_flow_nodes n
  WHERE n.flow_code = 'sorteo_default'
    AND n.node_code IN ('inicio', 'precio', 'humano', 'datos')
),
options_inicio AS (
  INSERT INTO public.chat_flow_options (node_id, label, option_value, meta_button_id, next_node_code, sort_order)
  SELECT
    n.id,
    v.label,
    v.option_value,
    v.meta_button_id,
    v.next_node_code,
    v.sort_order
  FROM all_seed_nodes n
  JOIN (
    VALUES
      ('inicio', 'Comprar entrada', 'comprar_entrada', 'comprar_entrada', 'precio', 1),
      ('inicio', 'Hablar con humano', 'hablar_humano', 'hablar_humano', 'humano', 2)
  ) AS v(node_code, label, option_value, meta_button_id, next_node_code, sort_order)
    ON v.node_code = n.node_code
  ON CONFLICT (node_id, meta_button_id) DO UPDATE
    SET label = EXCLUDED.label,
        option_value = EXCLUDED.option_value,
        next_node_code = EXCLUDED.next_node_code,
        sort_order = EXCLUDED.sort_order
  RETURNING id
)
INSERT INTO public.chat_flow_options (node_id, label, option_value, meta_button_id, next_node_code, sort_order)
SELECT
  n.id,
  v.label,
  v.option_value,
  v.meta_button_id,
  v.next_node_code,
  v.sort_order
FROM all_seed_nodes n
JOIN (
  VALUES
    ('precio', '1 entrada', '1_entrada', '1_entrada', 'datos', 1),
    ('precio', '3 entradas', '3_entradas', '3_entradas', 'datos', 2),
    ('precio', '5 entradas', '5_entradas', '5_entradas', 'datos', 3)
) AS v(node_code, label, option_value, meta_button_id, next_node_code, sort_order)
  ON v.node_code = n.node_code
ON CONFLICT (node_id, meta_button_id) DO UPDATE
  SET label = EXCLUDED.label,
      option_value = EXCLUDED.option_value,
      next_node_code = EXCLUDED.next_node_code,
      sort_order = EXCLUDED.sort_order;

COMMENT ON TABLE public.chat_flow_nodes IS 'Definición de nodos de flujo conversacional por empresa';
COMMENT ON TABLE public.chat_flow_options IS 'Opciones de navegación por nodo (botones/listas)';
COMMENT ON TABLE public.chat_flow_events IS 'Auditoría de eventos del flujo por conversación';
