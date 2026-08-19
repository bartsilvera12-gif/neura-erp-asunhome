-- =============================================================================
-- ferreteriarepublica.productos — descuento promocional con ventana temporal
--
-- Modelo (inspirado en tradexpar-digital-hub):
--   discount_type      'percentage' | 'fixed' | NULL  ← null = sin oferta
--   discount_value     numeric, 0 default
--   discount_starts_at timestamptz NULL → "desde siempre"
--   discount_ends_at   timestamptz NULL → "hasta siempre"
--
-- "Producto en oferta" se DERIVA en runtime con:
--   discount_type IS NOT NULL
--   AND discount_value > 0
--   AND now() BETWEEN coalesce(starts_at, '-infinity') AND coalesce(ends_at, 'infinity')
--
-- Ventajas sobre flag bool + precio_anterior:
--  - No duplica el precio base (se mantiene precio_venta intacto).
--  - Soporta % y monto fijo con un solo modelo.
--  - Ventana temporal: ofertas auto-expiran sin cron.
--  - "Sin restriccion" via NULL en las fechas.
--
-- ALCANCE: SOLO el schema `ferreteriarepublica`.
-- Idempotente.
-- =============================================================================

ALTER TABLE ferreteriarepublica.productos
  ADD COLUMN IF NOT EXISTS discount_type      text,
  ADD COLUMN IF NOT EXISTS discount_value     numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS discount_ends_at   timestamptz;

-- Check constraint del tipo. Idempotente: solo agrega si no existe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'productos_discount_type_chk'
      AND conrelid = 'ferreteriarepublica.productos'::regclass
  ) THEN
    ALTER TABLE ferreteriarepublica.productos
      ADD CONSTRAINT productos_discount_type_chk
      CHECK (discount_type IS NULL OR discount_type IN ('percentage', 'fixed'));
  END IF;
END $$;

COMMENT ON COLUMN ferreteriarepublica.productos.discount_type  IS 'Tipo de descuento promocional: percentage | fixed | NULL (sin oferta).';
COMMENT ON COLUMN ferreteriarepublica.productos.discount_value IS 'Valor del descuento (porcentaje 0-100 o monto en Gs.).';
COMMENT ON COLUMN ferreteriarepublica.productos.discount_starts_at IS 'Inicio de la ventana de oferta. NULL = sin restriccion.';
COMMENT ON COLUMN ferreteriarepublica.productos.discount_ends_at   IS 'Fin de la ventana de oferta. NULL = sin restriccion.';

-- Index parcial para listar ofertas activas rapido (endpoint del sitio).
CREATE INDEX IF NOT EXISTS productos_discount_active_idx
  ON ferreteriarepublica.productos (empresa_id, discount_ends_at)
  WHERE discount_type IS NOT NULL AND discount_value > 0;
