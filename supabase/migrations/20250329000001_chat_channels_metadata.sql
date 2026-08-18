-- =============================================================================
-- chat_channels: metadatos UI + activo (WhatsApp / Meta)
-- =============================================================================

ALTER TABLE public.chat_channels
  ADD COLUMN IF NOT EXISTS nombre text,
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'meta',
  ADD COLUMN IF NOT EXISTS provider_channel_id text,
  ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.chat_channels.nombre IS 'Etiqueta visible en el ERP';
COMMENT ON COLUMN public.chat_channels.provider IS 'Proveedor: meta';
COMMENT ON COLUMN public.chat_channels.provider_channel_id IS 'ID de canal en el proveedor (ej. WABA o mismo phone_number_id)';
COMMENT ON COLUMN public.chat_channels.activo IS 'Si false, el webhook no enruta mensajes nuevos a este canal';

CREATE INDEX IF NOT EXISTS idx_chat_channels_empresa_activo
  ON public.chat_channels(empresa_id, activo)
  WHERE activo = true;
