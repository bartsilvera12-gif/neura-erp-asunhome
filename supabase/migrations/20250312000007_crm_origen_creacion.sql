-- Preparación para futura integración WhatsApp: origen de creación del lead
-- manual = creado desde el formulario CRM por un usuario
-- whatsapp = creado automáticamente cuando llega un mensaje al número del sistema
ALTER TABLE public.crm_prospectos
  ADD COLUMN IF NOT EXISTS origen_creacion text NOT NULL DEFAULT 'manual'
  CHECK (origen_creacion IN ('manual', 'whatsapp'));

COMMENT ON COLUMN public.crm_prospectos.origen_creacion IS 'Origen del lead: manual (formulario) o whatsapp (mensaje entrante)';
