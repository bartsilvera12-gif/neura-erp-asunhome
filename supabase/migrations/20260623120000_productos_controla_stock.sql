-- =============================================================================
-- ferreteriarepublica.productos — columna `controla_stock`
--
-- Si controla_stock = true  -> se valida stock al vender (no permite vender
--                              si stock_actual < cantidad).
-- Si controla_stock = false -> el producto puede venderse aunque no tenga
--                              stock (servicios, tarifas, mano de obra).
--
-- ALCANCE: SOLO el schema `ferreteriarepublica`. NO tocar otros tenants.
-- Idempotente.
-- =============================================================================

ALTER TABLE ferreteriarepublica.productos
  ADD COLUMN IF NOT EXISTS controla_stock boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN ferreteriarepublica.productos.controla_stock IS
  'Si false, el producto puede venderse sin validar stock (servicios, tarifas).';
