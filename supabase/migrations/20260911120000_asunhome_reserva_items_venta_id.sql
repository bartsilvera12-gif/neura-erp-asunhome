-- =============================================================================
-- ASUNHOME — Facturación PARCIAL de guardas (por producto)
--
-- Agrega reserva_items.venta_id: vincula CADA ítem de la guarda con la venta en
-- la que fue facturado. NULL = ítem todavía "En guarda" (pendiente); seteado =
-- ese producto ya se facturó (en esa venta). Permite facturar/entregar productos
-- individualmente sin cancelar toda la guarda: los demás quedan pendientes.
--
-- La guarda pasa a estado 'facturada' solo cuando TODOS sus ítems tienen venta_id.
--
-- ALCANCE: SOLO el schema `asunhome`. Aditiva, NO toca datos históricos.
-- Idempotente. NO se aplica automáticamente: correr manualmente tras revisión.
-- =============================================================================

ALTER TABLE asunhome.reserva_items
  ADD COLUMN IF NOT EXISTS venta_id uuid;

COMMENT ON COLUMN asunhome.reserva_items.venta_id IS
  'Venta en la que se facturó este ítem de la guarda. NULL = pendiente (En guarda). '
  'Permite facturación parcial: cada producto se factura por separado y los demás '
  'quedan en guarda hasta que se facturen.';

CREATE INDEX IF NOT EXISTS reserva_items_idx_venta
  ON asunhome.reserva_items (venta_id) WHERE venta_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- ── Verificación (solo lectura) ─────────────────────────────────────────────
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
     WHERE table_schema='asunhome' AND table_name='reserva_items' AND column_name='venta_id')
    AS reserva_items_venta_id_col_ok,
  EXISTS (SELECT 1 FROM pg_indexes
     WHERE schemaname='asunhome' AND indexname='reserva_items_idx_venta')
    AS reserva_items_venta_id_idx_ok;
