-- =============================================================================
-- Omnicanal Etapa 1: canales (multi-tipo, YCloud), colas ↔ canales, agentes
-- Compatible con WhatsApp Meta existente; no rompe webhooks ni inbox.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- chat_channels: flexibilizar phone id, estado de configuración, modo conexión
-- -----------------------------------------------------------------------------
ALTER TABLE public.chat_channels
  DROP CONSTRAINT IF EXISTS chat_channels_meta_phone_number_id_key;

ALTER TABLE public.chat_channels
  ALTER COLUMN meta_phone_number_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS chat_channels_meta_phone_number_id_uidx
  ON public.chat_channels (meta_phone_number_id)
  WHERE meta_phone_number_id IS NOT NULL AND btrim(meta_phone_number_id) <> '';

ALTER TABLE public.chat_channels
  DROP CONSTRAINT IF EXISTS chat_channels_type_check;

ALTER TABLE public.chat_channels
  ADD CONSTRAINT chat_channels_type_check
  CHECK (type IN ('whatsapp', 'instagram', 'facebook', 'email', 'linkedin'));

ALTER TABLE public.chat_channels
  ADD COLUMN IF NOT EXISTS connection_mode text,
  ADD COLUMN IF NOT EXISTS config_status text NOT NULL DEFAULT 'incomplete';

ALTER TABLE public.chat_channels
  DROP CONSTRAINT IF EXISTS chat_channels_config_status_check;

ALTER TABLE public.chat_channels
  ADD CONSTRAINT chat_channels_config_status_check
  CHECK (config_status IN ('inactive', 'incomplete', 'active'));

COMMENT ON COLUMN public.chat_channels.connection_mode IS
  'whatsapp: official (Meta Cloud API) | coexistence (YCloud) | standard | null';
COMMENT ON COLUMN public.chat_channels.config_status IS
  'active = operativo; incomplete = falta credencial crítica; inactive = deshabilitado a propósito';

-- Backfill connection_mode y config_status (Meta activo si ya hay phone id)
UPDATE public.chat_channels c
SET
  connection_mode = v.conn,
  config_status = v.st
FROM (
  SELECT
    id,
    CASE
      WHEN type = 'whatsapp' AND lower(COALESCE(NULLIF(btrim(provider), ''), 'meta')) = 'meta' THEN
        COALESCE(NULLIF(btrim(connection_mode), ''), 'official')
      WHEN type = 'whatsapp' AND lower(btrim(provider)) = 'ycloud' THEN
        COALESCE(NULLIF(btrim(connection_mode), ''), 'coexistence')
      ELSE connection_mode
    END AS conn,
    CASE
      WHEN activo IS NOT TRUE THEN 'inactive'
      WHEN type = 'whatsapp' AND lower(COALESCE(NULLIF(btrim(provider), ''), 'meta')) = 'meta'
           AND meta_phone_number_id IS NOT NULL AND btrim(meta_phone_number_id) <> '' THEN 'active'
      WHEN type = 'whatsapp' AND lower(btrim(provider)) = 'ycloud'
           AND activo IS TRUE
           AND (COALESCE(config, '{}'::jsonb)->>'ycloud_api_key') IS NOT NULL
           AND btrim(COALESCE(config, '{}'::jsonb)->>'ycloud_api_key') <> '' THEN 'active'
      WHEN activo IS TRUE THEN 'incomplete'
      ELSE 'inactive'
    END AS st
  FROM public.chat_channels
) v
WHERE c.id = v.id;

-- -----------------------------------------------------------------------------
-- chat_queues: descripción, estrategia, prioridad; ampliar channel_type
-- -----------------------------------------------------------------------------
ALTER TABLE public.chat_queues
  ADD COLUMN IF NOT EXISTS descripcion text,
  ADD COLUMN IF NOT EXISTS distribution_strategy text NOT NULL DEFAULT 'least_load',
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 0;

ALTER TABLE public.chat_queues
  DROP CONSTRAINT IF EXISTS chat_queues_channel_type_check;

ALTER TABLE public.chat_queues
  ADD CONSTRAINT chat_queues_channel_type_check
  CHECK (
    channel_type IS NULL
    OR channel_type IN ('whatsapp', 'instagram', 'facebook', 'email', 'linkedin')
  );

ALTER TABLE public.chat_queues
  DROP CONSTRAINT IF EXISTS chat_queues_distribution_strategy_check;

ALTER TABLE public.chat_queues
  ADD CONSTRAINT chat_queues_distribution_strategy_check
  CHECK (distribution_strategy IN ('round_robin', 'least_load', 'manual_pull'));

COMMENT ON COLUMN public.chat_queues.distribution_strategy IS
  'round_robin | least_load (default) | manual_pull (sin auto-asignación desde cola)';

-- -----------------------------------------------------------------------------
-- Relación N:N cola ↔ canal (empresa_id denormalizado para RLS)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_queue_channels (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  queue_id    uuid NOT NULL REFERENCES public.chat_queues(id) ON DELETE CASCADE,
  channel_id  uuid NOT NULL REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (queue_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_queue_channels_queue ON public.chat_queue_channels(queue_id);
CREATE INDEX IF NOT EXISTS idx_chat_queue_channels_channel ON public.chat_queue_channels(channel_id);
CREATE INDEX IF NOT EXISTS idx_chat_queue_channels_empresa ON public.chat_queue_channels(empresa_id);

ALTER TABLE public.chat_queue_channels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_queue_channels_select" ON public.chat_queue_channels;
CREATE POLICY "chat_queue_channels_select" ON public.chat_queue_channels FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS "chat_queue_channels_insert" ON public.chat_queue_channels;
CREATE POLICY "chat_queue_channels_insert" ON public.chat_queue_channels FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS "chat_queue_channels_update" ON public.chat_queue_channels;
CREATE POLICY "chat_queue_channels_update" ON public.chat_queue_channels FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS "chat_queue_channels_delete" ON public.chat_queue_channels;
CREATE POLICY "chat_queue_channels_delete" ON public.chat_queue_channels FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

COMMENT ON TABLE public.chat_queue_channels IS
  'Canales atendidos por una cola; si está vacío se usa chat_queues.channel_type (legado)';

-- Backfill desde channel_type legacy hacia la tabla puente
INSERT INTO public.chat_queue_channels (empresa_id, queue_id, channel_id)
SELECT q.empresa_id, q.id, c.id
FROM public.chat_queues q
JOIN public.chat_channels c
  ON c.empresa_id = q.empresa_id
 AND lower(btrim(c.type)) = lower(btrim(q.channel_type))
WHERE q.channel_type IS NOT NULL
  AND btrim(q.channel_type) <> ''
ON CONFLICT (queue_id, channel_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- chat_agents: participación en distribución y prioridad
-- -----------------------------------------------------------------------------
ALTER TABLE public.chat_agents
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS receives_new_chats boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS priority_in_queue integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.chat_agents.receives_new_chats IS
  'Si false, el agente no entra en asignación automática de chats nuevos';
COMMENT ON COLUMN public.chat_agents.priority_in_queue IS
  'Mayor = preferido al empatar estrategias (Etapa 2 puede usarlo más)';
