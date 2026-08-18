-- =============================================================================
-- En lo de Mari — agregar columna metodo_pago a enlodemari.ventas.
-- Solo schema enlodemari. Idempotente. NO toca otros schemas.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'enlodemari'
      AND table_name = 'ventas'
      AND column_name = 'metodo_pago'
  ) THEN
    ALTER TABLE enlodemari.ventas
      ADD COLUMN metodo_pago text;
  END IF;

  -- Constraint suave (CHECK) para que el dominio quede claro. Idempotente.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'enlodemari'
      AND table_name = 'ventas'
      AND constraint_name = 'ventas_metodo_pago_chk'
  ) THEN
    ALTER TABLE enlodemari.ventas
      ADD CONSTRAINT ventas_metodo_pago_chk
      CHECK (metodo_pago IS NULL OR metodo_pago IN ('efectivo', 'tarjeta', 'transferencia'));
  END IF;
END $$;
