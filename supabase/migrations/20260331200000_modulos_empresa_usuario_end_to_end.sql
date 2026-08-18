-- =============================================================================
-- Módulos: coherencia empresa → usuario, catálogo completo, validación DB
-- =============================================================================

-- 1) Catálogo: módulos alineados con navegación ERP (slug = slug en Sidebar)
INSERT INTO public.modulos (id, nombre, slug)
SELECT gen_random_uuid(), 'Dashboard', 'dashboard'
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE slug = 'dashboard');

INSERT INTO public.modulos (id, nombre, slug)
SELECT gen_random_uuid(), 'Ventas', 'ventas'
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE slug = 'ventas');

INSERT INTO public.modulos (id, nombre, slug)
SELECT gen_random_uuid(), 'Inventario', 'inventario'
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE slug = 'inventario');

INSERT INTO public.modulos (id, nombre, slug)
SELECT gen_random_uuid(), 'Clientes', 'clientes'
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE slug = 'clientes');

INSERT INTO public.modulos (id, nombre, slug)
SELECT gen_random_uuid(), 'Compras', 'compras'
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE slug = 'compras');

INSERT INTO public.modulos (id, nombre, slug)
SELECT gen_random_uuid(), 'Usuarios', 'usuarios'
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE slug = 'usuarios');

INSERT INTO public.modulos (id, nombre, slug)
SELECT gen_random_uuid(), 'Configuración', 'configuracion'
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE slug = 'configuracion');

INSERT INTO public.modulos (id, nombre, slug)
SELECT gen_random_uuid(), 'Planes', 'planes'
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE slug = 'planes');

INSERT INTO public.modulos (id, nombre, slug)
SELECT gen_random_uuid(), 'Gestión Clientes', 'gestion-clientes'
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE slug = 'gestion-clientes');

INSERT INTO public.modulos (id, nombre, slug)
SELECT gen_random_uuid(), 'CRM Funnel', 'crm'
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE slug = 'crm');

-- 2) Sin auto-inyectar conversaciones: el super admin elige módulos al crear/editar empresa
DROP TRIGGER IF EXISTS tr_empresas_modulo_conversaciones ON public.empresas;
DROP FUNCTION IF EXISTS public.empresa_modulos_insertar_conversaciones();

-- 3) Trigger: usuario_modulos solo puede referir módulos activos de la empresa del usuario
CREATE OR REPLACE FUNCTION public.trg_usuario_modulos_validar_modulo_empresa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id uuid;
BEGIN
  SELECT u.empresa_id INTO v_empresa_id
  FROM public.usuarios u
  WHERE u.id = NEW.usuario_id;

  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'usuario_modulos: el usuario % no tiene empresa asignada', NEW.usuario_id
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.empresa_modulos em
    WHERE em.empresa_id = v_empresa_id
      AND em.modulo_id = NEW.modulo_id
      AND em.activo IS TRUE
  ) THEN
    RAISE EXCEPTION 'usuario_modulos: el módulo % no está habilitado para la empresa del usuario', NEW.modulo_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_usuario_modulos_validar_empresa ON public.usuario_modulos;
CREATE TRIGGER tr_usuario_modulos_validar_empresa
  BEFORE INSERT OR UPDATE OF modulo_id, usuario_id ON public.usuario_modulos
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_usuario_modulos_validar_modulo_empresa();

COMMENT ON FUNCTION public.trg_usuario_modulos_validar_modulo_empresa() IS
  'Impide asignar a un usuario un módulo que la empresa no tiene en empresa_modulos (activo).';

-- 4) Backfill: usuarios con empresa y sin filas en usuario_modulos reciben todos los módulos activos de su empresa
INSERT INTO public.usuario_modulos (usuario_id, modulo_id)
SELECT u.id, em.modulo_id
FROM public.usuarios u
JOIN public.empresa_modulos em
  ON em.empresa_id = u.empresa_id AND em.activo IS TRUE
WHERE u.empresa_id IS NOT NULL
  AND COALESCE(u.rol, '') <> 'super_admin'
  AND NOT EXISTS (SELECT 1 FROM public.usuario_modulos um WHERE um.usuario_id = u.id)
ON CONFLICT (usuario_id, modulo_id) DO NOTHING;

-- 5) Limpiar asignaciones huérfanas (módulo deshabilitado en empresa)
DELETE FROM public.usuario_modulos um
USING public.usuarios u
WHERE um.usuario_id = u.id
  AND u.empresa_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.empresa_modulos em
    WHERE em.empresa_id = u.empresa_id
      AND em.modulo_id = um.modulo_id
      AND em.activo IS TRUE
  );

-- 6) RLS: permitir que admin de empresa gestione usuario_modulos de usuarios de su empresa (además de super_admin)
DROP POLICY IF EXISTS "usuario_modulos_all_admin" ON public.usuario_modulos;

CREATE POLICY "usuario_modulos_insert"
  ON public.usuario_modulos FOR INSERT
  WITH CHECK (
    public.es_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.usuarios ua
      JOIN public.usuarios ut ON ut.id = usuario_id
      WHERE ua.email = (auth.jwt() ->> 'email')
        AND ua.empresa_id IS NOT NULL
        AND ua.empresa_id = ut.empresa_id
        AND COALESCE(ua.rol, '') IN ('admin', 'administrador')
    )
  );

CREATE POLICY "usuario_modulos_update"
  ON public.usuario_modulos FOR UPDATE
  USING (
    public.es_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.usuarios ua
      JOIN public.usuarios ut ON ut.id = usuario_id
      WHERE ua.email = (auth.jwt() ->> 'email')
        AND ua.empresa_id IS NOT NULL
        AND ua.empresa_id = ut.empresa_id
        AND COALESCE(ua.rol, '') IN ('admin', 'administrador')
    )
  )
  WITH CHECK (
    public.es_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.usuarios ua
      JOIN public.usuarios ut ON ut.id = usuario_id
      WHERE ua.email = (auth.jwt() ->> 'email')
        AND ua.empresa_id IS NOT NULL
        AND ua.empresa_id = ut.empresa_id
        AND COALESCE(ua.rol, '') IN ('admin', 'administrador')
    )
  );

CREATE POLICY "usuario_modulos_delete"
  ON public.usuario_modulos FOR DELETE
  USING (
    public.es_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.usuarios ua
      JOIN public.usuarios ut ON ut.id = usuario_id
      WHERE ua.email = (auth.jwt() ->> 'email')
        AND ua.empresa_id IS NOT NULL
        AND ua.empresa_id = ut.empresa_id
        AND COALESCE(ua.rol, '') IN ('admin', 'administrador')
    )
  );
