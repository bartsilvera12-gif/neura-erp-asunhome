-- =============================================================================
-- RLS Multiempresa - Neura ERP
-- Seguridad por fila: cada usuario solo ve datos de su empresa
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Función auxiliar: obtiene empresa_id del usuario autenticado
-- (En public, no auth: Supabase no permite CREATE en schema auth - error 42501)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.empresa_id_actual()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT empresa_id
  FROM public.usuarios
  WHERE email = (auth.jwt() ->> 'email')
  LIMIT 1;
$$;

-- -----------------------------------------------------------------------------
-- 2. Función auxiliar: verifica si el usuario es super_admin
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.es_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT rol = 'super_admin'
  FROM public.usuarios
  WHERE email = (auth.jwt() ->> 'email')
  LIMIT 1;
$$;

-- -----------------------------------------------------------------------------
-- 3. Función auxiliar: verifica acceso a empresa (usuario pertenece o es super_admin)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.puede_acceder_empresa(empresa_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.es_super_admin()
     OR empresa_uuid = public.empresa_id_actual();
$$;

-- -----------------------------------------------------------------------------
-- 4. EMPRESAS
-- -----------------------------------------------------------------------------
ALTER TABLE public.empresas ENABLE ROW LEVEL SECURITY;

-- SELECT: solo su empresa o super_admin
CREATE POLICY "empresas_select"
  ON public.empresas FOR SELECT
  USING (
    public.es_super_admin()
    OR id = public.empresa_id_actual()
  );

-- INSERT: solo super_admin (crear empresas)
CREATE POLICY "empresas_insert"
  ON public.empresas FOR INSERT
  WITH CHECK (public.es_super_admin());

-- UPDATE: solo su empresa o super_admin
CREATE POLICY "empresas_update"
  ON public.empresas FOR UPDATE
  USING (public.puede_acceder_empresa(id))
  WITH CHECK (public.puede_acceder_empresa(id));

-- DELETE: solo super_admin
CREATE POLICY "empresas_delete"
  ON public.empresas FOR DELETE
  USING (public.es_super_admin());

-- -----------------------------------------------------------------------------
-- 5. USUARIOS
-- -----------------------------------------------------------------------------
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;

-- SELECT: usuarios de su empresa o super_admin
CREATE POLICY "usuarios_select"
  ON public.usuarios FOR SELECT
  USING (
    public.es_super_admin()
    OR empresa_id = public.empresa_id_actual()
    OR (empresa_id IS NULL AND rol = 'super_admin')
  );

-- INSERT: admin de su empresa o super_admin
CREATE POLICY "usuarios_insert"
  ON public.usuarios FOR INSERT
  WITH CHECK (
    public.es_super_admin()
    OR (empresa_id = public.empresa_id_actual() AND empresa_id IS NOT NULL)
  );

-- UPDATE: usuarios de su empresa o super_admin
CREATE POLICY "usuarios_update"
  ON public.usuarios FOR UPDATE
  USING (
    public.es_super_admin()
    OR empresa_id = public.empresa_id_actual()
    OR (empresa_id IS NULL AND rol = 'super_admin')
  )
  WITH CHECK (
    public.es_super_admin()
    OR empresa_id = public.empresa_id_actual()
    OR (empresa_id IS NULL AND rol = 'super_admin')
  );

-- DELETE: solo super_admin
CREATE POLICY "usuarios_delete"
  ON public.usuarios FOR DELETE
  USING (public.es_super_admin());

-- -----------------------------------------------------------------------------
-- 6. EMPRESA_MODULOS
-- -----------------------------------------------------------------------------
ALTER TABLE public.empresa_modulos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "empresa_modulos_select"
  ON public.empresa_modulos FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));

CREATE POLICY "empresa_modulos_insert"
  ON public.empresa_modulos FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));

CREATE POLICY "empresa_modulos_update"
  ON public.empresa_modulos FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));

CREATE POLICY "empresa_modulos_delete"
  ON public.empresa_modulos FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

-- -----------------------------------------------------------------------------
-- 7. MODULOS (catálogo global - sin empresa_id)
-- -----------------------------------------------------------------------------
ALTER TABLE public.modulos ENABLE ROW LEVEL SECURITY;

-- SELECT: cualquier usuario autenticado
CREATE POLICY "modulos_select"
  ON public.modulos FOR SELECT
  TO authenticated
  USING (true);

-- INSERT/UPDATE/DELETE: solo super_admin
CREATE POLICY "modulos_insert"
  ON public.modulos FOR INSERT
  WITH CHECK (public.es_super_admin());

CREATE POLICY "modulos_update"
  ON public.modulos FOR UPDATE
  USING (public.es_super_admin())
  WITH CHECK (public.es_super_admin());

CREATE POLICY "modulos_delete"
  ON public.modulos FOR DELETE
  USING (public.es_super_admin());

-- -----------------------------------------------------------------------------
-- 8. CLIENTES
-- -----------------------------------------------------------------------------
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clientes_select"
  ON public.clientes FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));

CREATE POLICY "clientes_insert"
  ON public.clientes FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));

CREATE POLICY "clientes_update"
  ON public.clientes FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));

CREATE POLICY "clientes_delete"
  ON public.clientes FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

-- -----------------------------------------------------------------------------
-- 9. TABLAS ADICIONALES (descomentar y ajustar si existen)
-- -----------------------------------------------------------------------------
-- Si tienes más tablas con empresa_id, añade políticas similares:
--
-- ALTER TABLE public.<tabla> ENABLE ROW LEVEL SECURITY;
--
-- CREATE POLICY "<tabla>_select" ON public.<tabla> FOR SELECT
--   USING (public.puede_acceder_empresa(empresa_id));
--
-- CREATE POLICY "<tabla>_insert" ON public.<tabla> FOR INSERT
--   WITH CHECK (public.puede_acceder_empresa(empresa_id));
--
-- CREATE POLICY "<tabla>_update" ON public.<tabla> FOR UPDATE
--   USING (public.puede_acceder_empresa(empresa_id))
--   WITH CHECK (public.puede_acceder_empresa(empresa_id));
--
-- CREATE POLICY "<tabla>_delete" ON public.<tabla> FOR DELETE
--   USING (public.puede_acceder_empresa(empresa_id));
