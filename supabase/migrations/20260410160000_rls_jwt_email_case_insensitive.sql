-- =============================================================================
-- RLS: email JWT vs usuarios.email sin depender de mayúsculas/minúsculas
-- =============================================================================
-- GoTrue puede devolver el email del JWT con capitalización distinta a la
-- guardada en zentra_erp.usuarios. Con igualdad estricta, empresa_id_actual()
-- y es_super_admin() fallan → RLS bloquea catálogo y datos → UI “vacía”.
-- =============================================================================

CREATE OR REPLACE FUNCTION zentra_erp.jwt_email_normalized()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = zentra_erp
AS $$
  SELECT lower(trim(COALESCE(auth.jwt() ->> 'email', '')));
$$;

CREATE OR REPLACE FUNCTION zentra_erp.empresa_id_actual()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = zentra_erp
AS $$
  SELECT empresa_id
  FROM zentra_erp.usuarios
  WHERE lower(trim(COALESCE(email, ''))) = zentra_erp.jwt_email_normalized()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION zentra_erp.es_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = zentra_erp
AS $$
  SELECT rol = 'super_admin'
  FROM zentra_erp.usuarios
  WHERE lower(trim(COALESCE(email, ''))) = zentra_erp.jwt_email_normalized()
  LIMIT 1;
$$;

-- Ver también la fila propia si auth_user_id está bien enlazado aunque el email difiera.
DROP POLICY IF EXISTS "usuarios_select" ON zentra_erp.usuarios;
CREATE POLICY "usuarios_select"
  ON zentra_erp.usuarios FOR SELECT
  USING (
    zentra_erp.es_super_admin()
    OR empresa_id = zentra_erp.empresa_id_actual()
    OR (empresa_id IS NULL AND rol = 'super_admin')
    OR auth_user_id = auth.uid()
  );

-- usuario_modulos: políticas que aún comparaban email en crudo
DROP POLICY IF EXISTS "usuario_modulos_select" ON zentra_erp.usuario_modulos;
CREATE POLICY "usuario_modulos_select"
  ON zentra_erp.usuario_modulos FOR SELECT
  USING (
    zentra_erp.es_super_admin()
    OR usuario_id IN (
      SELECT id
      FROM zentra_erp.usuarios
      WHERE lower(trim(COALESCE(email, ''))) = zentra_erp.jwt_email_normalized()
    )
  );

DROP POLICY IF EXISTS "usuario_modulos_insert" ON zentra_erp.usuario_modulos;
CREATE POLICY "usuario_modulos_insert"
  ON zentra_erp.usuario_modulos FOR INSERT
  WITH CHECK (
    zentra_erp.es_super_admin()
    OR EXISTS (
      SELECT 1
      FROM zentra_erp.usuarios ua
      JOIN zentra_erp.usuarios ut ON ut.id = usuario_id
      WHERE lower(trim(COALESCE(ua.email, ''))) = zentra_erp.jwt_email_normalized()
        AND ua.empresa_id IS NOT NULL
        AND ua.empresa_id = ut.empresa_id
        AND COALESCE(ua.rol, '') IN ('admin', 'administrador')
    )
  );

DROP POLICY IF EXISTS "usuario_modulos_update" ON zentra_erp.usuario_modulos;
CREATE POLICY "usuario_modulos_update"
  ON zentra_erp.usuario_modulos FOR UPDATE
  USING (
    zentra_erp.es_super_admin()
    OR EXISTS (
      SELECT 1
      FROM zentra_erp.usuarios ua
      JOIN zentra_erp.usuarios ut ON ut.id = usuario_id
      WHERE lower(trim(COALESCE(ua.email, ''))) = zentra_erp.jwt_email_normalized()
        AND ua.empresa_id IS NOT NULL
        AND ua.empresa_id = ut.empresa_id
        AND COALESCE(ua.rol, '') IN ('admin', 'administrador')
    )
  )
  WITH CHECK (
    zentra_erp.es_super_admin()
    OR EXISTS (
      SELECT 1
      FROM zentra_erp.usuarios ua
      JOIN zentra_erp.usuarios ut ON ut.id = usuario_id
      WHERE lower(trim(COALESCE(ua.email, ''))) = zentra_erp.jwt_email_normalized()
        AND ua.empresa_id IS NOT NULL
        AND ua.empresa_id = ut.empresa_id
        AND COALESCE(ua.rol, '') IN ('admin', 'administrador')
    )
  );

DROP POLICY IF EXISTS "usuario_modulos_delete" ON zentra_erp.usuario_modulos;
CREATE POLICY "usuario_modulos_delete"
  ON zentra_erp.usuario_modulos FOR DELETE
  USING (
    zentra_erp.es_super_admin()
    OR EXISTS (
      SELECT 1
      FROM zentra_erp.usuarios ua
      JOIN zentra_erp.usuarios ut ON ut.id = usuario_id
      WHERE lower(trim(COALESCE(ua.email, ''))) = zentra_erp.jwt_email_normalized()
        AND ua.empresa_id IS NOT NULL
        AND ua.empresa_id = ut.empresa_id
        AND COALESCE(ua.rol, '') IN ('admin', 'administrador')
    )
  );
