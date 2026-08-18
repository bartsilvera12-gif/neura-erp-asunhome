-- Historial omnicanal: campos de auditoria + normalizacion de telefono.
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS sender_type text,
  ADD COLUMN IF NOT EXISTS sent_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS sent_by_user_name text,
  ADD COLUMN IF NOT EXISTS automation_source text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chat_messages_sender_type_check'
      AND conrelid = 'public.chat_messages'::regclass
  ) THEN
    ALTER TABLE public.chat_messages
      ADD CONSTRAINT chat_messages_sender_type_check
      CHECK (sender_type IN ('contact', 'ai', 'human', 'system'));
  END IF;
END $$;

UPDATE public.chat_messages
SET sender_type = CASE WHEN from_me THEN 'human' ELSE 'contact' END
WHERE sender_type IS NULL;

ALTER TABLE public.chat_messages
  ALTER COLUMN sender_type SET DEFAULT 'system';

ALTER TABLE public.chat_contacts
  ADD COLUMN IF NOT EXISTS phone_normalized text;

UPDATE public.chat_contacts
SET phone_normalized = NULLIF(regexp_replace(COALESCE(phone_number, ''), '\D', '', 'g'), '')
WHERE phone_normalized IS NULL
   OR phone_normalized = '';

CREATE OR REPLACE FUNCTION public.set_chat_contact_phone_normalized()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.phone_normalized := NULLIF(regexp_replace(COALESCE(NEW.phone_number, ''), '\D', '', 'g'), '');
  IF NEW.phone_normalized IS NOT NULL THEN
    NEW.phone_number := NEW.phone_normalized;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_chat_contacts_phone_normalized ON public.chat_contacts;
CREATE TRIGGER tr_chat_contacts_phone_normalized
  BEFORE INSERT OR UPDATE OF phone_number
  ON public.chat_contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_chat_contact_phone_normalized();

CREATE INDEX IF NOT EXISTS idx_chat_contacts_empresa_phone_normalized
  ON public.chat_contacts(empresa_id, phone_normalized);

CREATE INDEX IF NOT EXISTS idx_chat_contacts_empresa_name_lower
  ON public.chat_contacts(empresa_id, lower(name));

CREATE INDEX IF NOT EXISTS idx_chat_messages_empresa_created_at
  ON public.chat_messages(empresa_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_messages_sender_type
  ON public.chat_messages(sender_type);
