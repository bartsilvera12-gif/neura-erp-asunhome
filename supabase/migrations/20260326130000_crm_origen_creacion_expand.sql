-- =============================================================================
-- Expandir origen_creacion + agregar origen_detalle (para integración WhatsApp)
-- =============================================================================

-- Quitar CHECK restrictivo anterior (manual, whatsapp) si existe
DO $$
DECLARE c_name text;
BEGIN
  SELECT conname INTO c_name
  FROM pg_constraint
  WHERE conrelid = 'public.crm_prospectos'::regclass
    AND conname ILIKE '%origen_creacion%'
    AND conname ILIKE '%check%';

  IF c_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.crm_prospectos DROP CONSTRAINT %I', c_name);
  END IF;
END $$;

-- Agregar origen_detalle (metadata opcional)
ALTER TABLE public.crm_prospectos
  ADD COLUMN IF NOT EXISTS origen_detalle text NULL;

-- Índice para filtros por origen
CREATE INDEX IF NOT EXISTS idx_crm_prospectos_empresa_origen
  ON public.crm_prospectos(empresa_id, origen_creacion);

-- Comentarios (si aplica)
COMMENT ON COLUMN public.crm_prospectos.origen_creacion IS
  'Origen del lead: manual, whatsapp, formulario_web, referido, campaña_meta, automatizacion, otro';
COMMENT ON COLUMN public.crm_prospectos.origen_detalle IS
  'Detalle opcional del origen del lead (ej: campaña, referido, utm, etc.)';

