-- =============================================================================
-- Arqueo de caja por denominaciones (conteo físico de monedas y billetes).
--
-- Guarda el detalle completo del conteo (no solo el total) tanto en apertura
-- como en cierre, para auditoría/historial. El saldo_inicial (monto_apertura)
-- y saldo_contado (monto_cierre_contado) siguen siendo las columnas existentes
-- -- se calculan desde el detalle cuando el cajero usa el arqueo, pero no se
-- eliminan ni se renombran (compatibilidad con el flujo manual actual).
--
-- Single-schema (ferreteriarepublica). Aditiva, nullable, no destructiva.
-- =============================================================================

ALTER TABLE ferreteriarepublica.cajas
  ADD COLUMN IF NOT EXISTS arqueo_apertura_json jsonb,
  ADD COLUMN IF NOT EXISTS arqueo_cierre_json jsonb;
