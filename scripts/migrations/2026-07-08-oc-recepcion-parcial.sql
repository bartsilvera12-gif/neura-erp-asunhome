-- =============================================================================
-- Recepción parcial de Órdenes de Compra (OC) + trazabilidad con Compras.
--
-- Hoy una OC se "recibe" de una sola vez (todo o nada) y genera UNA compra con
-- exactamente los ítems/cantidades de la OC. Este cambio permite recibir
-- parcialmente: cada línea de OC acumula `cantidad_recibida` a través de una o
-- más compras, hasta completar `cantidad`.
--
-- ordenes_compra:
--   - cantidad_recibida: acumulado recibido de esa línea (todas las compras
--     que se hicieron contra esa OC). cantidad_pendiente = cantidad - cantidad_recibida
--     (se calcula en la app, no se persiste).
--   - estado pasa de ('abierta','recibida','cancelada') a
--     ('pendiente','recibida_parcial','recibida_total','cancelada').
--
-- compras:
--   - orden_compra_item_id: FK a la línea exacta de ordenes_compra que esa fila
--     de compra recibió (trazabilidad item a item, además de orden_compra_numero
--     que ya vincula al header/grupo de la OC).
--   - fecha_factura, observacion: campos de la compra real (factura del
--     proveedor) que antes no existían.
--
-- Single-schema (ferreteriarepublica). Aditiva e idempotente. No destructiva:
-- no se borra ninguna columna ni fila existente.
-- =============================================================================

ALTER TABLE ferreteriarepublica.ordenes_compra
  ADD COLUMN IF NOT EXISTS cantidad_recibida numeric NOT NULL DEFAULT 0;

-- Migra datos existentes (defensivo; hoy no hay filas, pero es idempotente).
UPDATE ferreteriarepublica.ordenes_compra SET estado = 'pendiente' WHERE estado = 'abierta';
UPDATE ferreteriarepublica.ordenes_compra SET estado = 'recibida_total', cantidad_recibida = cantidad
  WHERE estado = 'recibida';

ALTER TABLE ferreteriarepublica.ordenes_compra DROP CONSTRAINT IF EXISTS ordenes_compra_estado_check;
ALTER TABLE ferreteriarepublica.ordenes_compra ADD CONSTRAINT ordenes_compra_estado_check
  CHECK (estado IN ('pendiente', 'recibida_parcial', 'recibida_total', 'cancelada'));

ALTER TABLE ferreteriarepublica.compras
  ADD COLUMN IF NOT EXISTS orden_compra_item_id uuid
    REFERENCES ferreteriarepublica.ordenes_compra(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fecha_factura date,
  ADD COLUMN IF NOT EXISTS observacion text;

CREATE INDEX IF NOT EXISTS idx_compras_orden_compra_item
  ON ferreteriarepublica.compras (orden_compra_item_id);
