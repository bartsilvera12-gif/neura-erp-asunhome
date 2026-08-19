-- Producción / fabricación desde recetas (solo schema reservacaacupe). Idempotente.
-- 1) productos.modo_receta: preparado_al_vender (default) | produccion_previa.
-- 2) movimientos_inventario.origen admite 'produccion'; + produccion_id para trazar.
-- 3) Tablas producciones + produccion_items.

-- 1) modo_receta -----------------------------------------------------------
ALTER TABLE reservacaacupe.productos
  ADD COLUMN IF NOT EXISTS modo_receta text NOT NULL DEFAULT 'preparado_al_vender';

ALTER TABLE reservacaacupe.productos
  DROP CONSTRAINT IF EXISTS productos_modo_receta_check;
ALTER TABLE reservacaacupe.productos
  ADD CONSTRAINT productos_modo_receta_check
  CHECK (modo_receta = ANY (ARRAY['preparado_al_vender'::text, 'produccion_previa'::text]));

-- 2) movimientos: origen 'produccion' + produccion_id ----------------------
ALTER TABLE reservacaacupe.movimientos_inventario
  DROP CONSTRAINT IF EXISTS movimientos_inventario_origen_check;
ALTER TABLE reservacaacupe.movimientos_inventario
  ADD CONSTRAINT movimientos_inventario_origen_check
  CHECK (origen = ANY (ARRAY['compra'::text, 'venta'::text, 'ajuste_manual'::text, 'inventario_inicial'::text, 'produccion'::text]));

ALTER TABLE reservacaacupe.movimientos_inventario
  ADD COLUMN IF NOT EXISTS produccion_id uuid;

-- 3) producciones ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS reservacaacupe.producciones (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id           uuid NOT NULL,
  receta_id            uuid,
  producto_id          uuid NOT NULL,
  producto_nombre      text NOT NULL,
  cantidad_fabricada   numeric NOT NULL,
  rendimiento_cantidad numeric NOT NULL DEFAULT 1,
  unidad_rendimiento   text,
  costo_total          numeric NOT NULL DEFAULT 0,
  costo_unitario       numeric NOT NULL DEFAULT 0,
  fecha                timestamptz NOT NULL DEFAULT now(),
  usuario_id           uuid,
  usuario_nombre       text,
  observaciones        text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reservacaacupe.produccion_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL,
  produccion_id       uuid NOT NULL REFERENCES reservacaacupe.producciones(id) ON DELETE CASCADE,
  insumo_producto_id  uuid NOT NULL,
  insumo_nombre       text NOT NULL,
  cantidad            numeric NOT NULL,
  unidad_medida       text,
  costo_unitario      numeric NOT NULL DEFAULT 0,
  subcosto            numeric NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_producciones_empresa_fecha ON reservacaacupe.producciones (empresa_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_produccion_items_produccion ON reservacaacupe.produccion_items (produccion_id);
CREATE INDEX IF NOT EXISTS idx_mov_produccion_id ON reservacaacupe.movimientos_inventario (produccion_id);
