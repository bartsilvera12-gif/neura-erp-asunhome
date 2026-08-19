-- ============================================================================
-- Migracion: Presentaciones de producto (venta por caja/unidad/etc).
-- Schema: ferreteriarepublica
-- Fecha: 2026-06-26
--
-- Idempotente: se puede correr varias veces sin efectos secundarios.
-- NO destructiva: no borra ni reinicializa stock, ventas ni productos.
--
-- Estructura:
-- - `productos.unidad_medida` ya existe y default 'Unidad' -> se reutiliza
--   como "unidad base" del producto. No se agrega columna nueva.
-- - Tabla `producto_presentaciones`: define como se vende el producto
--   (Unidad, Caja, Paquete...) con la equivalencia en unidad base.
-- - `ventas_items` recibe 4 columnas nullable para guardar el SNAPSHOT de
--   la presentacion usada en cada venta (asi los reportes historicos no se
--   rompen si despues se edita la presentacion).
-- - Backfill: cada producto existente recibe una presentacion default
--   'Unidad' con cantidad_base=1, sin precio override (usa el del producto).
-- ============================================================================

SET search_path TO ferreteriarepublica, public;

-- ---------------------------------------------------------------------------
-- 1) Tabla producto_presentaciones
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ferreteriarepublica.producto_presentaciones (
  id              uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  empresa_id      uuid NOT NULL,
  producto_id     uuid NOT NULL,
  nombre          text NOT NULL,
  -- Equivalencia en unidad base. Ej: "Caja" con cantidad_base=1000 significa
  -- que 1 caja = 1000 unidades base. Siempre > 0.
  cantidad_base   numeric NOT NULL CHECK (cantidad_base > 0),
  -- Precio override opcional para esta presentacion. Si NULL, la UI/API
  -- deberia usar productos.precio_venta * cantidad_base como precio efectivo
  -- (es solo una convencion para mostrar; lo importante es persistir lo que
  -- el cajero efectivamente cobre en ventas_items.precio_venta).
  precio_venta    numeric NULL CHECK (precio_venta IS NULL OR precio_venta >= 0),
  es_default      boolean NOT NULL DEFAULT false,
  activo          boolean NOT NULL DEFAULT true,
  created_at      timestamp with time zone NOT NULL DEFAULT now(),
  updated_at      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT producto_presentaciones_producto_fk
    FOREIGN KEY (producto_id) REFERENCES ferreteriarepublica.productos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS producto_presentaciones_empresa_idx
  ON ferreteriarepublica.producto_presentaciones (empresa_id);
CREATE INDEX IF NOT EXISTS producto_presentaciones_producto_idx
  ON ferreteriarepublica.producto_presentaciones (producto_id);

-- UNIQUE por nombre dentro del mismo producto (case-insensitive). Evita dos
-- presentaciones "Caja" para el mismo producto.
CREATE UNIQUE INDEX IF NOT EXISTS producto_presentaciones_nombre_uniq
  ON ferreteriarepublica.producto_presentaciones (producto_id, lower(nombre));

-- UNIQUE parcial: solo UNA presentacion default activa por producto.
CREATE UNIQUE INDEX IF NOT EXISTS producto_presentaciones_default_uniq
  ON ferreteriarepublica.producto_presentaciones (producto_id)
  WHERE es_default = true AND activo = true;

-- Trigger para mantener updated_at al dia.
CREATE OR REPLACE FUNCTION ferreteriarepublica.touch_producto_presentaciones_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS producto_presentaciones_touch ON ferreteriarepublica.producto_presentaciones;
CREATE TRIGGER producto_presentaciones_touch
  BEFORE UPDATE ON ferreteriarepublica.producto_presentaciones
  FOR EACH ROW
  EXECUTE FUNCTION ferreteriarepublica.touch_producto_presentaciones_updated_at();

-- ---------------------------------------------------------------------------
-- 2) Columnas snapshot en ventas_items
-- ---------------------------------------------------------------------------
-- presentacion_id: referencia historica. NO usamos FK con ON DELETE para no
-- impedir que se desactiven presentaciones viejas. Si en el futuro se borrara
-- una presentacion, el id queda dangling y se usa el snapshot.
ALTER TABLE ferreteriarepublica.ventas_items
  ADD COLUMN IF NOT EXISTS presentacion_id uuid NULL,
  ADD COLUMN IF NOT EXISTS presentacion_nombre text NULL,
  ADD COLUMN IF NOT EXISTS presentacion_cantidad_base numeric NULL,
  ADD COLUMN IF NOT EXISTS cantidad_total_base numeric NULL;

COMMENT ON COLUMN ferreteriarepublica.ventas_items.presentacion_id IS
  'FK historica a producto_presentaciones. NULL = item legacy o sin presentacion (cantidad ES la cantidad base).';
COMMENT ON COLUMN ferreteriarepublica.ventas_items.presentacion_nombre IS
  'Snapshot del nombre de la presentacion al momento de la venta. NULL para items legacy.';
COMMENT ON COLUMN ferreteriarepublica.ventas_items.presentacion_cantidad_base IS
  'Snapshot de cuantas unidades base equivale 1 unidad de esta presentacion. NULL para items legacy (asumir 1).';
COMMENT ON COLUMN ferreteriarepublica.ventas_items.cantidad_total_base IS
  'cantidad * presentacion_cantidad_base. Es lo que efectivamente se descuento de stock_actual. NULL para items legacy.';

-- ---------------------------------------------------------------------------
-- 3) Backfill: presentacion default "Unidad" por producto existente.
-- ---------------------------------------------------------------------------
-- Solo crea la presentacion si el producto AUN NO TIENE ninguna. Idempotente.
INSERT INTO ferreteriarepublica.producto_presentaciones
  (empresa_id, producto_id, nombre, cantidad_base, precio_venta, es_default, activo)
SELECT
  p.empresa_id,
  p.id,
  -- Usar el unidad_medida existente como nombre. Si es null/vacio cae a 'Unidad'.
  COALESCE(NULLIF(TRIM(p.unidad_medida), ''), 'Unidad'),
  1,
  NULL,  -- sin override; usa precio_venta del producto
  true,
  true
FROM ferreteriarepublica.productos p
WHERE NOT EXISTS (
  SELECT 1
  FROM ferreteriarepublica.producto_presentaciones pp
  WHERE pp.producto_id = p.id
);

-- ---------------------------------------------------------------------------
-- 4) Verificacion
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  prods_sin_pres bigint;
  prods_multi_default bigint;
BEGIN
  SELECT COUNT(*) INTO prods_sin_pres
  FROM ferreteriarepublica.productos p
  WHERE NOT EXISTS (
    SELECT 1 FROM ferreteriarepublica.producto_presentaciones pp
    WHERE pp.producto_id = p.id
  );

  SELECT COUNT(*) INTO prods_multi_default
  FROM (
    SELECT producto_id
    FROM ferreteriarepublica.producto_presentaciones
    WHERE es_default = true AND activo = true
    GROUP BY producto_id
    HAVING COUNT(*) > 1
  ) x;

  RAISE NOTICE 'Migration check -> productos sin presentacion: %, productos con >1 default: %', prods_sin_pres, prods_multi_default;
END;
$$;
