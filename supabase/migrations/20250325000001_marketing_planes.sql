-- =============================================================================
-- Marketing Ops - Planes de marketing y plantilla operativa
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Planes: es_plan_marketing y plantilla_operativa
-- -----------------------------------------------------------------------------
ALTER TABLE public.planes
  ADD COLUMN IF NOT EXISTS es_plan_marketing boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS plantilla_operativa jsonb;

-- -----------------------------------------------------------------------------
-- 2. marketing_tasks: trazabilidad y generación automática
-- -----------------------------------------------------------------------------
ALTER TABLE public.marketing_tasks
  ADD COLUMN IF NOT EXISTS suscripcion_id uuid REFERENCES public.suscripciones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES public.planes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS generada_automaticamente boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_marketing_tasks_suscripcion ON public.marketing_tasks(suscripcion_id);
CREATE INDEX IF NOT EXISTS idx_marketing_tasks_plan ON public.marketing_tasks(plan_id);
