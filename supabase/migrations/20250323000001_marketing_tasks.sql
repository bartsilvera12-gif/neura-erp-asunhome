-- =============================================================================
-- Marketing Ops - Tabla marketing_tasks
-- Tareas de producción de contenido para clientes tipo_servicio_cliente = 'marketing'
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.marketing_tasks (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id           uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  cliente_id           uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  titulo               text NOT NULL,
  descripcion          text,
  tipo_contenido       text NOT NULL CHECK (tipo_contenido IN ('post', 'reel', 'historia', 'anuncio', 'otro')),
  estado               text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'en_proceso', 'en_revision', 'aprobado', 'publicado')),
  fecha_entrega        date NOT NULL,
  responsable_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  prioridad            text CHECK (prioridad IS NULL OR prioridad IN ('baja', 'media', 'alta', 'urgente')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_marketing_tasks_empresa ON public.marketing_tasks(empresa_id);
CREATE INDEX idx_marketing_tasks_cliente ON public.marketing_tasks(cliente_id);
CREATE INDEX idx_marketing_tasks_fecha ON public.marketing_tasks(fecha_entrega);
CREATE INDEX idx_marketing_tasks_estado ON public.marketing_tasks(estado);

ALTER TABLE public.marketing_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "marketing_tasks_select"
  ON public.marketing_tasks FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));

CREATE POLICY "marketing_tasks_insert"
  ON public.marketing_tasks FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));

CREATE POLICY "marketing_tasks_update"
  ON public.marketing_tasks FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));

CREATE POLICY "marketing_tasks_delete"
  ON public.marketing_tasks FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

-- Trigger updated_at
DROP TRIGGER IF EXISTS marketing_tasks_updated_at ON public.marketing_tasks;
CREATE TRIGGER marketing_tasks_updated_at
  BEFORE UPDATE ON public.marketing_tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Módulo Marketing Ops
INSERT INTO public.modulos (id, nombre, slug)
SELECT gen_random_uuid(), 'Marketing Ops', 'marketing'
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE slug = 'marketing');

-- Habilitar para empresas existentes
INSERT INTO public.empresa_modulos (empresa_id, modulo_id, activo)
SELECT e.id, m.id, true
FROM public.empresas e
CROSS JOIN public.modulos m
WHERE m.slug = 'marketing'
  AND NOT EXISTS (
    SELECT 1 FROM public.empresa_modulos em
    WHERE em.empresa_id = e.id AND em.modulo_id = m.id
  );
