-- =============================================================================
-- Inventario gastronómico — campos aditivos en productos (enlodemari)
-- Idempotente. Solo schema enlodemari. NO toca otros schemas.
-- =============================================================================

ALTER TABLE enlodemari.productos
  ADD COLUMN IF NOT EXISTS controla_stock        boolean  NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS valorizado            boolean  NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS unidad_compra         text,
  ADD COLUMN IF NOT EXISTS unidad_receta         text,
  ADD COLUMN IF NOT EXISTS factor_compra_receta  numeric  NOT NULL DEFAULT 1 CHECK (factor_compra_receta > 0),
  ADD COLUMN IF NOT EXISTS tiempo_prep_minutos   int      NOT NULL DEFAULT 0 CHECK (tiempo_prep_minutos >= 0);

COMMENT ON COLUMN enlodemari.productos.controla_stock IS
  'Si false, el producto no descuenta stock (ajustes, servicios, tarifas).';
COMMENT ON COLUMN enlodemari.productos.valorizado IS
  'Si false, no entra en valuación de inventario (combos, promociones).';
COMMENT ON COLUMN enlodemari.productos.unidad_compra IS
  'Unidad usada al comprar (ej. "Bolsa 25kg").';
COMMENT ON COLUMN enlodemari.productos.unidad_receta IS
  'Unidad usada en recetas (ej. "g", "ml").';
COMMENT ON COLUMN enlodemari.productos.factor_compra_receta IS
  'Factor para convertir 1 unidad de compra a unidades de receta (ej. 25000 g por bolsa).';
COMMENT ON COLUMN enlodemari.productos.tiempo_prep_minutos IS
  'Tiempo estimado de preparación en minutos (para Kanban de cocina).';
