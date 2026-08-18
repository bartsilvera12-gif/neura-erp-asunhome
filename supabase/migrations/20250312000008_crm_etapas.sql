-- Estados del pipeline CRM configurables por empresa
-- Permite a cada empresa definir sus propias etapas del funnel

-- 1. Crear tabla crm_etapas (idempotente)
CREATE TABLE IF NOT EXISTS public.crm_etapas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  codigo      text NOT NULL,
  nombre      text NOT NULL,
  color       text NOT NULL DEFAULT 'gray',
  orden       integer NOT NULL DEFAULT 0,
  activo      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(empresa_id, codigo)
);

CREATE INDEX IF NOT EXISTS idx_crm_etapas_empresa ON public.crm_etapas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_crm_etapas_empresa_orden ON public.crm_etapas(empresa_id, orden);

ALTER TABLE public.crm_etapas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "crm_etapas_select" ON public.crm_etapas;
CREATE POLICY "crm_etapas_select" ON public.crm_etapas FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS "crm_etapas_insert" ON public.crm_etapas;
CREATE POLICY "crm_etapas_insert" ON public.crm_etapas FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS "crm_etapas_update" ON public.crm_etapas;
CREATE POLICY "crm_etapas_update" ON public.crm_etapas FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS "crm_etapas_delete" ON public.crm_etapas;
CREATE POLICY "crm_etapas_delete" ON public.crm_etapas FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

-- 2. Permitir etapas personalizadas en crm_prospectos (quitar CHECK fijo)
ALTER TABLE public.crm_prospectos DROP CONSTRAINT IF EXISTS crm_prospectos_etapa_check;

-- 3. Seed etapas por defecto para empresas existentes
INSERT INTO public.crm_etapas (empresa_id, codigo, nombre, color, orden, activo)
SELECT e.id, v.codigo, v.nombre, v.color, v.orden, true
FROM public.empresas e
CROSS JOIN (VALUES
  ('LEAD', 'Lead', 'gray', 1),
  ('CONTACTADO', 'Contactado', 'blue', 2),
  ('NEGOCIACION', 'Negociación', 'amber', 3),
  ('GANADO', 'Ganado', 'green', 4),
  ('PERDIDO', 'Perdido', 'red', 5)
) AS v(codigo, nombre, color, orden)
ON CONFLICT (empresa_id, codigo) DO NOTHING;

-- Trigger updated_at (solo si no existe)
DROP TRIGGER IF EXISTS crm_etapas_updated_at ON public.crm_etapas;
CREATE TRIGGER crm_etapas_updated_at
  BEFORE UPDATE ON public.crm_etapas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
