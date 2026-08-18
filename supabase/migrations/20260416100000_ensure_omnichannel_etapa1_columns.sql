-- Asegura columnas/tablas de Etapa 1 omnicanal en bases donde faltara parte del despliegue (idempotente).

ALTER TABLE public.chat_channels ADD COLUMN IF NOT EXISTS connection_mode text;
ALTER TABLE public.chat_channels ADD COLUMN IF NOT EXISTS config_status text;
UPDATE public.chat_channels SET config_status = COALESCE(config_status, 'incomplete') WHERE config_status IS NULL;

ALTER TABLE public.chat_queues ADD COLUMN IF NOT EXISTS descripcion text;
ALTER TABLE public.chat_queues ADD COLUMN IF NOT EXISTS distribution_strategy text;
ALTER TABLE public.chat_queues ADD COLUMN IF NOT EXISTS priority integer;
UPDATE public.chat_queues SET distribution_strategy = COALESCE(NULLIF(btrim(distribution_strategy), ''), 'least_load')
  WHERE distribution_strategy IS NULL OR btrim(distribution_strategy) = '';
UPDATE public.chat_queues SET priority = COALESCE(priority, 0) WHERE priority IS NULL;

ALTER TABLE public.chat_agents ADD COLUMN IF NOT EXISTS is_active boolean;
ALTER TABLE public.chat_agents ADD COLUMN IF NOT EXISTS receives_new_chats boolean;
ALTER TABLE public.chat_agents ADD COLUMN IF NOT EXISTS priority_in_queue integer;
UPDATE public.chat_agents SET is_active = COALESCE(is_active, true) WHERE is_active IS NULL;
UPDATE public.chat_agents SET receives_new_chats = COALESCE(receives_new_chats, true) WHERE receives_new_chats IS NULL;
UPDATE public.chat_agents SET priority_in_queue = COALESCE(priority_in_queue, 0) WHERE priority_in_queue IS NULL;

ALTER TABLE public.chat_agents ALTER COLUMN is_active SET DEFAULT true;
ALTER TABLE public.chat_agents ALTER COLUMN receives_new_chats SET DEFAULT true;
ALTER TABLE public.chat_agents ALTER COLUMN priority_in_queue SET DEFAULT 0;
