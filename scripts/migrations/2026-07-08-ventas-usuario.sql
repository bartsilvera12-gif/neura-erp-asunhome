-- =============================================================================
-- Auditoría de venta: quién la registró.
--
-- La tabla ventas no guardaba el usuario que hizo la venta. Se agregan
-- created_by (PK zentra_erp.usuarios.id) y usuario_nombre (nombre para mostrar),
-- para el listado de ventas y el detalle.
--
-- Single-schema (ferreteriarepublica). Aditiva e idempotente.
-- =============================================================================

ALTER TABLE ferreteriarepublica.ventas
  ADD COLUMN IF NOT EXISTS created_by     uuid,
  ADD COLUMN IF NOT EXISTS usuario_nombre text;
