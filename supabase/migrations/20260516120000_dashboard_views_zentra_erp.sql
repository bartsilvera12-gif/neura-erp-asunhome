-- =============================================================================
-- Vistas de dashboard: catálogo global + habilitación por empresa + permisos por usuario
-- Patrón alineado a modulos / empresa_modulos / usuario_modulos (zentra_erp)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Catálogo
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS zentra_erp.dashboard_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  nombre text NOT NULL,
  orden int NOT NULL DEFAULT 0,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slug)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_views_activo ON zentra_erp.dashboard_views (activo);

COMMENT ON TABLE zentra_erp.dashboard_views IS
  'Catálogo global de vistas del tablero principal (Comercial, Financiero, etc.).';

-- Semilla: las 4 pestañas actuales del home (slug = Tab en la app)
INSERT INTO zentra_erp.dashboard_views (slug, nombre, orden, activo)
VALUES
  ('comercial',   'Comercial',   10, true),
  ('financiero',  'Financiero',  20, true),
  ('inventario',  'Inventario',  30, true),
  ('ventas',      'Ventas',      40, true)
ON CONFLICT (slug) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  orden = EXCLUDED.orden,
  activo = EXCLUDED.activo;

-- -----------------------------------------------------------------------------
-- 2) Habilitación por empresa
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS zentra_erp.empresa_dashboard_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
  dashboard_view_id uuid NOT NULL REFERENCES zentra_erp.dashboard_views(id) ON DELETE CASCADE,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, dashboard_view_id)
);

CREATE INDEX IF NOT EXISTS idx_edv_empresa ON zentra_erp.empresa_dashboard_views (empresa_id);
CREATE INDEX IF NOT EXISTS idx_edv_view ON zentra_erp.empresa_dashboard_views (dashboard_view_id);

COMMENT ON TABLE zentra_erp.empresa_dashboard_views IS
  'Qué vistas de dashboard tiene contratadas / habilitadas cada empresa.';

-- -----------------------------------------------------------------------------
-- 3) Permisos por usuario (subconjunto de empresa)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS zentra_erp.usuario_dashboard_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES zentra_erp.usuarios(id) ON DELETE CASCADE,
  dashboard_view_id uuid NOT NULL REFERENCES zentra_erp.dashboard_views(id) ON DELETE CASCADE,
  es_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (usuario_id, dashboard_view_id)
);

CREATE INDEX IF NOT EXISTS idx_udv_usuario ON zentra_erp.usuario_dashboard_views (usuario_id);

-- A lo sumo una vista marcada como predeterminada por usuario
CREATE UNIQUE INDEX IF NOT EXISTS uq_udv_one_default_per_user
  ON zentra_erp.usuario_dashboard_views (usuario_id)
  WHERE (es_default IS TRUE);

COMMENT ON TABLE zentra_erp.usuario_dashboard_views IS
  'Vistas del dashboard permitidas por usuario (intersección con empresa_dashboard_views).';

-- -----------------------------------------------------------------------------
-- 4) Retrocompat: empresas sin filas reciben las 4 vistas (igual que módulos vacíos = “todo”)
-- -----------------------------------------------------------------------------
INSERT INTO zentra_erp.empresa_dashboard_views (empresa_id, dashboard_view_id, activo)
SELECT e.id, dv.id, true
FROM zentra_erp.empresas e
CROSS JOIN zentra_erp.dashboard_views dv
WHERE dv.activo IS TRUE
  AND NOT EXISTS (
    SELECT 1 FROM zentra_erp.empresa_dashboard_views x WHERE x.empresa_id = e.id
  )
ON CONFLICT (empresa_id, dashboard_view_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 5) RLS
-- -----------------------------------------------------------------------------
ALTER TABLE zentra_erp.dashboard_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dashboard_views_select_auth" ON zentra_erp.dashboard_views;
CREATE POLICY "dashboard_views_select_auth"
  ON zentra_erp.dashboard_views FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "dashboard_views_all_super" ON zentra_erp.dashboard_views;
CREATE POLICY "dashboard_views_all_super"
  ON zentra_erp.dashboard_views FOR ALL
  USING (zentra_erp.es_super_admin())
  WITH CHECK (zentra_erp.es_super_admin());

ALTER TABLE zentra_erp.empresa_dashboard_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "edv_select" ON zentra_erp.empresa_dashboard_views;
CREATE POLICY "edv_select"
  ON zentra_erp.empresa_dashboard_views FOR SELECT
  USING (zentra_erp.puede_acceder_empresa(empresa_id));

DROP POLICY IF EXISTS "edv_mutate" ON zentra_erp.empresa_dashboard_views;
CREATE POLICY "edv_mutate"
  ON zentra_erp.empresa_dashboard_views FOR INSERT
  WITH CHECK (
    zentra_erp.es_super_admin()
    OR zentra_erp.puede_acceder_empresa(empresa_id)
  );

DROP POLICY IF EXISTS "edv_update" ON zentra_erp.empresa_dashboard_views;
CREATE POLICY "edv_update"
  ON zentra_erp.empresa_dashboard_views FOR UPDATE
  USING (zentra_erp.es_super_admin() OR zentra_erp.puede_acceder_empresa(empresa_id))
  WITH CHECK (zentra_erp.es_super_admin() OR zentra_erp.puede_acceder_empresa(empresa_id));

DROP POLICY IF EXISTS "edv_delete" ON zentra_erp.empresa_dashboard_views;
CREATE POLICY "edv_delete"
  ON zentra_erp.empresa_dashboard_views FOR DELETE
  USING (zentra_erp.es_super_admin() OR zentra_erp.puede_acceder_empresa(empresa_id));

ALTER TABLE zentra_erp.usuario_dashboard_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "udv_select" ON zentra_erp.usuario_dashboard_views;
CREATE POLICY "udv_select"
  ON zentra_erp.usuario_dashboard_views FOR SELECT
  USING (
    zentra_erp.es_super_admin()
    OR usuario_id IN (
      SELECT id FROM zentra_erp.usuarios
      WHERE lower(trim(COALESCE(email, '')))
        = lower(trim(COALESCE(auth.jwt() ->> 'email', '')))
    )
  );

DROP POLICY IF EXISTS "udv_insert" ON zentra_erp.usuario_dashboard_views;
CREATE POLICY "udv_insert"
  ON zentra_erp.usuario_dashboard_views FOR INSERT
  WITH CHECK (
    zentra_erp.es_super_admin()
    OR EXISTS (
      SELECT 1
      FROM zentra_erp.usuarios ua
      JOIN zentra_erp.usuarios ut ON ut.id = usuario_id
      WHERE lower(trim(COALESCE(ua.email, '')))
        = lower(trim(COALESCE(auth.jwt() ->> 'email', '')))
        AND ua.empresa_id IS NOT NULL
        AND ua.empresa_id = ut.empresa_id
        AND COALESCE(ua.rol, '') IN ('admin', 'administrador')
    )
  );

DROP POLICY IF EXISTS "udv_update" ON zentra_erp.usuario_dashboard_views;
CREATE POLICY "udv_update"
  ON zentra_erp.usuario_dashboard_views FOR UPDATE
  USING (
    zentra_erp.es_super_admin()
    OR EXISTS (
      SELECT 1
      FROM zentra_erp.usuarios ua
      JOIN zentra_erp.usuarios ut ON ut.id = usuario_id
      WHERE lower(trim(COALESCE(ua.email, '')))
        = lower(trim(COALESCE(auth.jwt() ->> 'email', '')))
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
      WHERE lower(trim(COALESCE(ua.email, '')))
        = lower(trim(COALESCE(auth.jwt() ->> 'email', '')))
        AND ua.empresa_id IS NOT NULL
        AND ua.empresa_id = ut.empresa_id
        AND COALESCE(ua.rol, '') IN ('admin', 'administrador')
    )
  );

DROP POLICY IF EXISTS "udv_delete" ON zentra_erp.usuario_dashboard_views;
CREATE POLICY "udv_delete"
  ON zentra_erp.usuario_dashboard_views FOR DELETE
  USING (
    zentra_erp.es_super_admin()
    OR EXISTS (
      SELECT 1
      FROM zentra_erp.usuarios ua
      JOIN zentra_erp.usuarios ut ON ut.id = usuario_id
      WHERE lower(trim(COALESCE(ua.email, '')))
        = lower(trim(COALESCE(auth.jwt() ->> 'email', '')))
        AND ua.empresa_id IS NOT NULL
        AND ua.empresa_id = ut.empresa_id
        AND COALESCE(ua.rol, '') IN ('admin', 'administrador')
    )
  );
