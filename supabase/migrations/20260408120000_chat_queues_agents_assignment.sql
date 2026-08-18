-- =============================================================================
-- Colas, agentes y asignación automática de conversaciones (omnicanal)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Colas por empresa (opcionalmente atadas a un tipo de canal)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_queues (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nombre       text NOT NULL,
  is_active    boolean NOT NULL DEFAULT true,
  channel_type text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_queues_channel_type_check CHECK (
    channel_type IS NULL
    OR channel_type IN ('whatsapp', 'instagram', 'facebook', 'email')
  )
);

CREATE INDEX IF NOT EXISTS idx_chat_queues_empresa_active
  ON public.chat_queues(empresa_id, is_active)
  WHERE is_active = true;

DROP TRIGGER IF EXISTS tr_chat_queues_updated ON public.chat_queues;
CREATE TRIGGER tr_chat_queues_updated
  BEFORE UPDATE ON public.chat_queues
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.chat_queues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chat_queues_select" ON public.chat_queues FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_queues_insert" ON public.chat_queues FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_queues_update" ON public.chat_queues FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_queues_delete" ON public.chat_queues FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

COMMENT ON TABLE public.chat_queues IS 'Cola de enrutamiento; channel_type NULL = todos los canales de la empresa';
COMMENT ON COLUMN public.chat_queues.channel_type IS 'Si no es NULL, esta cola aplica solo a chat_channels.type igual';

-- -----------------------------------------------------------------------------
-- Agentes (usuarios ERP) por cola
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_agents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  usuario_id          uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  queue_id            uuid NOT NULL REFERENCES public.chat_queues(id) ON DELETE CASCADE,
  is_online           boolean NOT NULL DEFAULT false,
  max_conversations   integer NOT NULL DEFAULT 5 CHECK (max_conversations >= 1),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (usuario_id, queue_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_agents_queue ON public.chat_agents(queue_id);
CREATE INDEX IF NOT EXISTS idx_chat_agents_empresa ON public.chat_agents(empresa_id);
CREATE INDEX IF NOT EXISTS idx_chat_agents_online ON public.chat_agents(queue_id, is_online) WHERE is_online = true;

DROP TRIGGER IF EXISTS tr_chat_agents_updated ON public.chat_agents;
CREATE TRIGGER tr_chat_agents_updated
  BEFORE UPDATE ON public.chat_agents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.chat_agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chat_agents_select" ON public.chat_agents FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_agents_insert" ON public.chat_agents FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_agents_update" ON public.chat_agents FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_agents_delete" ON public.chat_agents FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

COMMENT ON TABLE public.chat_agents IS 'Usuario operador por cola; carga = conversaciones abiertas asignadas';

-- -----------------------------------------------------------------------------
-- Extender conversaciones: cola, agente, prioridad; nuevo ciclo de vida (status)
-- -----------------------------------------------------------------------------
ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS assigned_agent_id uuid REFERENCES public.chat_agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS queue_id uuid REFERENCES public.chat_queues(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'medium';

ALTER TABLE public.chat_conversations
  DROP CONSTRAINT IF EXISTS chat_conversations_priority_check;
ALTER TABLE public.chat_conversations
  ADD CONSTRAINT chat_conversations_priority_check
  CHECK (priority IN ('low', 'medium', 'high'));

CREATE INDEX IF NOT EXISTS idx_chat_conversations_assigned_agent
  ON public.chat_conversations(assigned_agent_id)
  WHERE assigned_agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_conversations_queue
  ON public.chat_conversations(queue_id)
  WHERE queue_id IS NOT NULL;

-- Migrar status comercial previo → ciclo operador (open / pending / closed)
ALTER TABLE public.chat_conversations DROP CONSTRAINT IF EXISTS chat_conversations_status_check;

UPDATE public.chat_conversations
SET status = CASE
  WHEN status = 'cerrado' THEN 'closed'
  WHEN status = 'pendiente' THEN 'pending'
  ELSE 'open'
END;

ALTER TABLE public.chat_conversations
  ALTER COLUMN status SET DEFAULT 'open';

ALTER TABLE public.chat_conversations
  ADD CONSTRAINT chat_conversations_status_check
  CHECK (status IN ('open', 'pending', 'closed'));

COMMENT ON COLUMN public.chat_conversations.status IS 'Ciclo operador: open | pending | closed';
COMMENT ON COLUMN public.chat_conversations.assigned_agent_id IS 'Agente responsable (chat_agents.id)';
COMMENT ON COLUMN public.chat_conversations.queue_id IS 'Cola por la que entró la conversación';
