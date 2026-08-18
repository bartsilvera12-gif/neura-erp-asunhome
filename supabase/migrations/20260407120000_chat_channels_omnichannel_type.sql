-- Omnicanal: ampliar valores permitidos de chat_channels.type
-- (la columna ya existía con CHECK solo 'whatsapp' en 20250327000001)

ALTER TABLE public.chat_channels
  DROP CONSTRAINT IF EXISTS chat_channels_type_check;

ALTER TABLE public.chat_channels
  ADD CONSTRAINT chat_channels_type_check
  CHECK (type IN ('whatsapp', 'instagram', 'facebook', 'email'));

COMMENT ON COLUMN public.chat_channels.type IS 'Canal omnicanal: whatsapp | instagram | facebook | email';
