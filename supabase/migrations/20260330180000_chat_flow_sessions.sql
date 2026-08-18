-- =============================================================================
-- Sesiones de flujo (run) por conversación: aisla datos transaccionales entre reinicios.
-- Antes: chat_flow_data se leía por (conversation_id, flow_code) y la hidratación
-- desde eventos podía mezclar turnos; el delete al reinicio no dejaba trazabilidad clara.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.chat_flow_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  conversation_id  uuid NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  flow_code        text NOT NULL,
  status           text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'abandoned', 'restarted')),
  started_at       timestamptz NOT NULL DEFAULT now(),
  ended_at         timestamptz,
  end_reason       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_flow_sessions_conversation
  ON public.chat_flow_sessions(conversation_id, flow_code, status);
CREATE INDEX IF NOT EXISTS idx_chat_flow_sessions_empresa
  ON public.chat_flow_sessions(empresa_id);

COMMENT ON TABLE public.chat_flow_sessions IS
  'Una ejecución del flujo en un chat; chat_flow_data y eventos relevantes van ligados a esta fila.';

ALTER TABLE public.chat_flow_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_flow_sessions_select" ON public.chat_flow_sessions;
DROP POLICY IF EXISTS "chat_flow_sessions_insert" ON public.chat_flow_sessions;
DROP POLICY IF EXISTS "chat_flow_sessions_update" ON public.chat_flow_sessions;
DROP POLICY IF EXISTS "chat_flow_sessions_delete" ON public.chat_flow_sessions;

CREATE POLICY "chat_flow_sessions_select" ON public.chat_flow_sessions FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_flow_sessions_insert" ON public.chat_flow_sessions FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_flow_sessions_update" ON public.chat_flow_sessions FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_flow_sessions_delete" ON public.chat_flow_sessions FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

-- Mensaje WhatsApp si faltan datos para registrar sorteo (editable desde ERP).
ALTER TABLE public.chat_flows
  ADD COLUMN IF NOT EXISTS sorteo_datos_incompletos_message text;

COMMENT ON COLUMN public.chat_flows.sorteo_datos_incompletos_message IS
  'Texto al cliente cuando falta nombre/cantidad/opción para crear la orden de sorteo; vacío = default del servidor.';

ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS active_flow_session_id uuid REFERENCES public.chat_flow_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chat_conversations_active_flow_session
  ON public.chat_conversations(active_flow_session_id);

COMMENT ON COLUMN public.chat_conversations.active_flow_session_id IS
  'Sesión de flujo activa; lecturas/escrituras de variables usan solo esta fila.';

ALTER TABLE public.chat_flow_data
  ADD COLUMN IF NOT EXISTS flow_session_id uuid REFERENCES public.chat_flow_sessions(id) ON DELETE CASCADE;

-- Sesión por cada conversación con flujo asignado (estado inicial = activa).
INSERT INTO public.chat_flow_sessions (empresa_id, conversation_id, flow_code, status, started_at)
SELECT c.empresa_id, c.id, btrim(c.flow_code), 'active', now()
FROM public.chat_conversations c
WHERE c.flow_code IS NOT NULL
  AND btrim(c.flow_code) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.chat_flow_sessions s
    WHERE s.conversation_id = c.id AND s.flow_code = btrim(c.flow_code)
  );

UPDATE public.chat_flow_data d
SET flow_session_id = s.id
FROM public.chat_flow_sessions s
WHERE d.flow_session_id IS NULL
  AND d.conversation_id = s.conversation_id
  AND d.flow_code = s.flow_code
  AND d.empresa_id = s.empresa_id;

-- Filas huérfanas (sin conv o flujo raro): asignar sesión nueva solo para esa conv+flow
INSERT INTO public.chat_flow_sessions (empresa_id, conversation_id, flow_code, status, started_at, end_reason)
SELECT DISTINCT d.empresa_id, d.conversation_id, d.flow_code, 'active', now(), 'backfill_orphan_flow_data'
FROM public.chat_flow_data d
WHERE d.flow_session_id IS NULL;

UPDATE public.chat_flow_data d
SET flow_session_id = s.id
FROM public.chat_flow_sessions s
WHERE d.flow_session_id IS NULL
  AND d.conversation_id = s.conversation_id
  AND d.flow_code = s.flow_code
  AND d.empresa_id = s.empresa_id
  AND s.end_reason = 'backfill_orphan_flow_data';

DELETE FROM public.chat_flow_data WHERE flow_session_id IS NULL;

ALTER TABLE public.chat_flow_data
  ALTER COLUMN flow_session_id SET NOT NULL;

DROP INDEX IF EXISTS public.uq_chat_flow_data_conversation_flow_field;

CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_flow_data_session_field
  ON public.chat_flow_data(flow_session_id, field_name);

CREATE INDEX IF NOT EXISTS idx_chat_flow_data_flow_session
  ON public.chat_flow_data(flow_session_id);

COMMENT ON COLUMN public.chat_flow_data.flow_session_id IS
  'Run del flujo; único junto con field_name.';

UPDATE public.chat_conversations c
SET active_flow_session_id = (
  SELECT s.id
  FROM public.chat_flow_sessions s
  WHERE s.conversation_id = c.id
    AND s.flow_code = btrim(c.flow_code)
  ORDER BY s.started_at DESC
  LIMIT 1
)
WHERE c.flow_code IS NOT NULL
  AND btrim(c.flow_code) <> '';

-- Eventos: ligar lecturas de contexto a la sesión actual
ALTER TABLE public.chat_flow_events
  ADD COLUMN IF NOT EXISTS flow_session_id uuid REFERENCES public.chat_flow_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chat_flow_events_session_created
  ON public.chat_flow_events(flow_session_id, created_at);

COMMENT ON COLUMN public.chat_flow_events.flow_session_id IS
  'Sesión a la que pertenece el evento; hidratación usa solo la sesión activa.';

-- Una sola sesión activa por conversación (el chat solo tiene un flow_code vigente).
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_flow_sessions_one_active_per_conversation
  ON public.chat_flow_sessions(conversation_id)
  WHERE status = 'active';
