-- Token de acceso Meta para enviar mensajes desde el ERP (opcional si existe WHATSAPP_TOKEN en el servidor).
-- No exponer en selects del cliente: listar canales sin esta columna.
ALTER TABLE public.chat_channels
  ADD COLUMN IF NOT EXISTS whatsapp_access_token text;

COMMENT ON COLUMN public.chat_channels.whatsapp_access_token IS
  'Bearer de la app Meta para POST /messages; alternativa a WHATSAPP_TOKEN en Vercel';
