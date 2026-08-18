-- =============================================================================
-- Módulo Conversaciones WhatsApp (Cloud API / Meta) — MVP
-- Requiere: public.set_updated_at, public.puede_acceder_empresa
-- =============================================================================

INSERT INTO public.modulos (id, nombre, slug)
SELECT gen_random_uuid(), 'Conversaciones', 'conversaciones'
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE slug = 'conversaciones');

-- -----------------------------------------------------------------------------
-- Canal: una fila por número de negocio (phone_number_id de Meta)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_channels (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  type                  text NOT NULL DEFAULT 'whatsapp' CHECK (type = 'whatsapp'),
  meta_phone_number_id  text NOT NULL,
  config                jsonb NOT NULL DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meta_phone_number_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_channels_empresa ON public.chat_channels(empresa_id);

DROP TRIGGER IF EXISTS tr_chat_channels_updated ON public.chat_channels;
CREATE TRIGGER tr_chat_channels_updated
  BEFORE UPDATE ON public.chat_channels
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.chat_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chat_channels_select" ON public.chat_channels FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_channels_insert" ON public.chat_channels FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_channels_update" ON public.chat_channels FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_channels_delete" ON public.chat_channels FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

-- -----------------------------------------------------------------------------
-- Contacto WhatsApp (vinculación opcional a cliente / prospecto CRM)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_contacts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  phone_number      text NOT NULL,
  name              text,
  cliente_id        uuid REFERENCES public.clientes(id) ON DELETE SET NULL,
  crm_prospecto_id  uuid REFERENCES public.crm_prospectos(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, phone_number)
);

CREATE INDEX IF NOT EXISTS idx_chat_contacts_empresa ON public.chat_contacts(empresa_id);
CREATE INDEX IF NOT EXISTS idx_chat_contacts_cliente ON public.chat_contacts(cliente_id);
CREATE INDEX IF NOT EXISTS idx_chat_contacts_prospecto ON public.chat_contacts(crm_prospecto_id);

DROP TRIGGER IF EXISTS tr_chat_contacts_updated ON public.chat_contacts;
CREATE TRIGGER tr_chat_contacts_updated
  BEFORE UPDATE ON public.chat_contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.chat_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chat_contacts_select" ON public.chat_contacts FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_contacts_insert" ON public.chat_contacts FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_contacts_update" ON public.chat_contacts FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_contacts_delete" ON public.chat_contacts FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

-- -----------------------------------------------------------------------------
-- Conversación (una por contacto + canal)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_conversations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id           uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  channel_id           uuid NOT NULL REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  contact_id           uuid NOT NULL REFERENCES public.chat_contacts(id) ON DELETE CASCADE,
  status               text NOT NULL DEFAULT 'nuevo'
    CHECK (status IN ('nuevo', 'interesado', 'pendiente', 'cerrado')),
  last_message_at      timestamptz,
  last_message_preview text,
  unread_count         integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contact_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_conv_empresa_last ON public.chat_conversations(empresa_id, last_message_at DESC NULLS LAST);

DROP TRIGGER IF EXISTS tr_chat_conversations_updated ON public.chat_conversations;
CREATE TRIGGER tr_chat_conversations_updated
  BEFORE UPDATE ON public.chat_conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chat_conversations_select" ON public.chat_conversations FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_conversations_insert" ON public.chat_conversations FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_conversations_update" ON public.chat_conversations FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_conversations_delete" ON public.chat_conversations FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

-- -----------------------------------------------------------------------------
-- Mensajes
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  conversation_id  uuid NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  wa_message_id    text,
  from_me          boolean NOT NULL DEFAULT false,
  message_type     text NOT NULL DEFAULT 'text',
  content          text,
  raw_payload      jsonb NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_msg_conv ON public.chat_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_msg_empresa ON public.chat_messages(empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_msg_wa_id ON public.chat_messages (wa_message_id)
  WHERE wa_message_id IS NOT NULL;

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chat_messages_select" ON public.chat_messages FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_messages_insert" ON public.chat_messages FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_messages_update" ON public.chat_messages FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_messages_delete" ON public.chat_messages FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

COMMENT ON TABLE public.chat_channels IS 'WhatsApp: meta_phone_number_id = phone_number_id del Graph API';
COMMENT ON TABLE public.chat_contacts IS 'Contacto por número; opcional cliente_id / crm_prospecto_id';
COMMENT ON TABLE public.chat_conversations IS 'Una conversación por (contacto, canal)';
COMMENT ON TABLE public.chat_messages IS 'Historial; wa_message_id único cuando viene de Meta';
