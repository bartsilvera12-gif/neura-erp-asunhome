-- =============================================================================
-- Recetas / Costeo MVP — instancia dedicada monocliente En lo de Mari
-- Idempotente. Aplica solo en schema `enlodemari`. NO toca otros schemas.
-- =============================================================================

-- 1) Productos: flags es_insumo / es_vendible (aditivo)
ALTER TABLE enlodemari.productos
  ADD COLUMN IF NOT EXISTS es_insumo  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS es_vendible boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_productos_es_insumo
  ON enlodemari.productos (empresa_id) WHERE es_insumo = true;
CREATE INDEX IF NOT EXISTS idx_productos_es_vendible
  ON enlodemari.productos (empresa_id) WHERE es_vendible = true;

-- 2) Recetas (cabecera)
CREATE TABLE IF NOT EXISTS enlodemari.recetas (
  id                     uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  empresa_id             uuid NOT NULL REFERENCES enlodemari.empresas(id) ON DELETE CASCADE,
  producto_id            uuid NOT NULL REFERENCES enlodemari.productos(id) ON DELETE CASCADE,
  nombre                 text,
  rendimiento_cantidad   numeric NOT NULL DEFAULT 1 CHECK (rendimiento_cantidad > 0),
  rendimiento_unidad     text,
  notas                  text,
  activa                 boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid,
  CONSTRAINT recetas_empresa_producto_uq UNIQUE (empresa_id, producto_id)
);

CREATE INDEX IF NOT EXISTS idx_recetas_empresa ON enlodemari.recetas (empresa_id);
CREATE INDEX IF NOT EXISTS idx_recetas_producto ON enlodemari.recetas (producto_id);

-- 3) Receta items (insumos)
CREATE TABLE IF NOT EXISTS enlodemari.receta_items (
  id                  uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES enlodemari.empresas(id) ON DELETE CASCADE,
  receta_id           uuid NOT NULL REFERENCES enlodemari.recetas(id) ON DELETE CASCADE,
  insumo_producto_id  uuid NOT NULL REFERENCES enlodemari.productos(id) ON DELETE RESTRICT,
  cantidad            numeric NOT NULL CHECK (cantidad > 0),
  unidad_medida       text,
  merma_pct           numeric NOT NULL DEFAULT 0 CHECK (merma_pct >= 0 AND merma_pct < 1),
  orden               int NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT receta_items_unicos UNIQUE (receta_id, insumo_producto_id)
);

CREATE INDEX IF NOT EXISTS idx_receta_items_receta ON enlodemari.receta_items (receta_id);
CREATE INDEX IF NOT EXISTS idx_receta_items_insumo ON enlodemari.receta_items (insumo_producto_id);
CREATE INDEX IF NOT EXISTS idx_receta_items_empresa ON enlodemari.receta_items (empresa_id);

-- 4) Trigger updated_at (reutiliza el patrón del ERP; crea local si no existe en este schema)
CREATE OR REPLACE FUNCTION enlodemari._touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recetas_updated_at ON enlodemari.recetas;
CREATE TRIGGER trg_recetas_updated_at BEFORE UPDATE ON enlodemari.recetas
  FOR EACH ROW EXECUTE FUNCTION enlodemari._touch_updated_at();

DROP TRIGGER IF EXISTS trg_receta_items_updated_at ON enlodemari.receta_items;
CREATE TRIGGER trg_receta_items_updated_at BEFORE UPDATE ON enlodemari.receta_items
  FOR EACH ROW EXECUTE FUNCTION enlodemari._touch_updated_at();

-- 5) RLS (espeja patrón de productos: USING puede_acceder_empresa(empresa_id))
ALTER TABLE enlodemari.recetas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE enlodemari.receta_items  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recetas_select ON enlodemari.recetas;
DROP POLICY IF EXISTS recetas_insert ON enlodemari.recetas;
DROP POLICY IF EXISTS recetas_update ON enlodemari.recetas;
DROP POLICY IF EXISTS recetas_delete ON enlodemari.recetas;

CREATE POLICY recetas_select ON enlodemari.recetas
  FOR SELECT USING (enlodemari.puede_acceder_empresa(empresa_id));
CREATE POLICY recetas_insert ON enlodemari.recetas
  FOR INSERT WITH CHECK (enlodemari.puede_acceder_empresa(empresa_id));
CREATE POLICY recetas_update ON enlodemari.recetas
  FOR UPDATE USING (enlodemari.puede_acceder_empresa(empresa_id))
  WITH CHECK (enlodemari.puede_acceder_empresa(empresa_id));
CREATE POLICY recetas_delete ON enlodemari.recetas
  FOR DELETE USING (enlodemari.puede_acceder_empresa(empresa_id));

DROP POLICY IF EXISTS receta_items_select ON enlodemari.receta_items;
DROP POLICY IF EXISTS receta_items_insert ON enlodemari.receta_items;
DROP POLICY IF EXISTS receta_items_update ON enlodemari.receta_items;
DROP POLICY IF EXISTS receta_items_delete ON enlodemari.receta_items;

CREATE POLICY receta_items_select ON enlodemari.receta_items
  FOR SELECT USING (enlodemari.puede_acceder_empresa(empresa_id));
CREATE POLICY receta_items_insert ON enlodemari.receta_items
  FOR INSERT WITH CHECK (enlodemari.puede_acceder_empresa(empresa_id));
CREATE POLICY receta_items_update ON enlodemari.receta_items
  FOR UPDATE USING (enlodemari.puede_acceder_empresa(empresa_id))
  WITH CHECK (enlodemari.puede_acceder_empresa(empresa_id));
CREATE POLICY receta_items_delete ON enlodemari.receta_items
  FOR DELETE USING (enlodemari.puede_acceder_empresa(empresa_id));

-- 6) Grants (mirror standard pattern del schema)
GRANT SELECT, INSERT, UPDATE, DELETE ON enlodemari.recetas, enlodemari.receta_items
  TO authenticated, service_role;

-- 7) Función de costeo: costo total, margen, unidades posibles
-- Devuelve jsonb con: { costo_total, precio_venta, margen_pct, unidades_posibles, items: [...] }
CREATE OR REPLACE FUNCTION enlodemari.fn_receta_costeo(p_receta_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = enlodemari, public
AS $$
DECLARE
  v_costo_total       numeric := 0;
  v_precio_venta      numeric := 0;
  v_rendimiento       numeric := 1;
  v_unidades_posibles numeric;
  v_items             jsonb;
  v_producto_id       uuid;
BEGIN
  SELECT r.producto_id, COALESCE(r.rendimiento_cantidad, 1), COALESCE(p.precio_venta, 0)
    INTO v_producto_id, v_rendimiento, v_precio_venta
  FROM enlodemari.recetas r
  JOIN enlodemari.productos p ON p.id = r.producto_id
  WHERE r.id = p_receta_id;

  IF v_producto_id IS NULL THEN
    RETURN jsonb_build_object('error', 'receta_no_encontrada');
  END IF;

  -- Items con sub-costo y unidades_aporte_disponibles
  WITH item_calc AS (
    SELECT
      ri.id,
      ri.insumo_producto_id,
      pi.nombre AS insumo_nombre,
      ri.cantidad,
      ri.unidad_medida,
      ri.merma_pct,
      pi.costo_promedio,
      pi.stock_actual,
      (ri.cantidad * (1 + ri.merma_pct)) AS cantidad_efectiva,
      (ri.cantidad * (1 + ri.merma_pct) * COALESCE(pi.costo_promedio, 0)) AS subcosto,
      CASE WHEN ri.cantidad * (1 + ri.merma_pct) > 0
           THEN FLOOR(COALESCE(pi.stock_actual, 0) / (ri.cantidad * (1 + ri.merma_pct)))
           ELSE NULL
      END AS unidades_aporte
    FROM enlodemari.receta_items ri
    JOIN enlodemari.productos pi ON pi.id = ri.insumo_producto_id
    WHERE ri.receta_id = p_receta_id
    ORDER BY ri.orden, pi.nombre
  )
  SELECT
    COALESCE(SUM(subcosto), 0),
    COALESCE(MIN(unidades_aporte), 0),
    COALESCE(jsonb_agg(jsonb_build_object(
      'item_id', id,
      'insumo_producto_id', insumo_producto_id,
      'insumo_nombre', insumo_nombre,
      'cantidad', cantidad,
      'unidad_medida', unidad_medida,
      'merma_pct', merma_pct,
      'costo_promedio', costo_promedio,
      'stock_actual', stock_actual,
      'subcosto', subcosto,
      'unidades_aporte', unidades_aporte
    )), '[]'::jsonb)
    INTO v_costo_total, v_unidades_posibles, v_items
  FROM item_calc;

  -- Si receta no tiene items, unidades_posibles = NULL (no infinito ni 0 engañoso)
  IF NOT EXISTS (SELECT 1 FROM enlodemari.receta_items WHERE receta_id = p_receta_id) THEN
    v_unidades_posibles := NULL;
  END IF;

  RETURN jsonb_build_object(
    'receta_id', p_receta_id,
    'producto_id', v_producto_id,
    'rendimiento_cantidad', v_rendimiento,
    'costo_total', v_costo_total,
    'costo_unitario', CASE WHEN v_rendimiento > 0 THEN v_costo_total / v_rendimiento ELSE NULL END,
    'precio_venta', v_precio_venta,
    'margen_abs', v_precio_venta - (CASE WHEN v_rendimiento > 0 THEN v_costo_total / v_rendimiento ELSE 0 END),
    'margen_pct', CASE
      WHEN v_precio_venta > 0 AND v_rendimiento > 0
      THEN ROUND(((v_precio_venta - (v_costo_total / v_rendimiento)) / v_precio_venta * 100)::numeric, 2)
      ELSE NULL
    END,
    'unidades_posibles', v_unidades_posibles,
    'items', v_items
  );
END;
$$;

GRANT EXECUTE ON FUNCTION enlodemari.fn_receta_costeo(uuid) TO anon, authenticated, service_role;

-- 8) Catálogo: módulo recetas (idempotente)
INSERT INTO enlodemari.modulos (slug, nombre, descripcion)
SELECT 'recetas', 'Recetas', 'Recetas y costeo de productos'
WHERE NOT EXISTS (SELECT 1 FROM enlodemari.modulos WHERE slug = 'recetas');

-- 9) Activar módulo recetas para la empresa única (id de Mari)
INSERT INTO enlodemari.empresa_modulos (empresa_id, modulo_id, activo)
SELECT '3983553a-de4b-4edf-bc6f-3f86025a97dc'::uuid, m.id, true
FROM enlodemari.modulos m
WHERE m.slug = 'recetas'
  AND NOT EXISTS (
    SELECT 1 FROM enlodemari.empresa_modulos em
    WHERE em.empresa_id = '3983553a-de4b-4edf-bc6f-3f86025a97dc'::uuid
      AND em.modulo_id = m.id
  );
