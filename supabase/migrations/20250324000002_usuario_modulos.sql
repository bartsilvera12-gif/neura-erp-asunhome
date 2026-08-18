-- Módulos visibles por usuario (subconjunto de los habilitados para la empresa)
-- La empresa habilita módulos en empresa_modulos; el usuario solo ve los que tiene en usuario_modulos.
-- Si usuario_modulos está vacío para un usuario, ve todos los módulos de su empresa (retrocompatibilidad).
CREATE TABLE IF NOT EXISTS public.usuario_modulos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  modulo_id uuid NOT NULL REFERENCES public.modulos(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(usuario_id, modulo_id)
);

CREATE INDEX IF NOT EXISTS idx_usuario_modulos_usuario ON public.usuario_modulos(usuario_id);

ALTER TABLE public.usuario_modulos ENABLE ROW LEVEL SECURITY;

-- Solo super_admin puede gestionar usuario_modulos
CREATE POLICY "usuario_modulos_select"
  ON public.usuario_modulos FOR SELECT
  USING (
    (SELECT rol FROM public.usuarios WHERE email = (auth.jwt() ->> 'email') LIMIT 1) = 'super_admin'
    OR usuario_id IN (SELECT id FROM public.usuarios WHERE email = (auth.jwt() ->> 'email'))
  );

CREATE POLICY "usuario_modulos_all_admin"
  ON public.usuario_modulos FOR ALL
  USING ((SELECT rol FROM public.usuarios WHERE email = (auth.jwt() ->> 'email') LIMIT 1) = 'super_admin');
