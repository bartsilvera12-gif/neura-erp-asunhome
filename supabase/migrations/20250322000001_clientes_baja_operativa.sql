-- =============================================================================
-- Clientes: Baja operativa - auditoría
-- No destructivo: solo agrega columnas
-- =============================================================================

ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS baja_operativa_at timestamptz,
  ADD COLUMN IF NOT EXISTS baja_operativa_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS baja_operativa_motivo text,
  ADD COLUMN IF NOT EXISTS baja_operativa_anulo_factura boolean;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'clientes_baja_operativa_by_user_id_fkey'
    AND table_name = 'clientes'
  ) THEN
    ALTER TABLE public.clientes
      ADD CONSTRAINT clientes_baja_operativa_by_user_id_fkey
      FOREIGN KEY (baja_operativa_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_clientes_baja_operativa_at ON public.clientes(baja_operativa_at)
  WHERE baja_operativa_at IS NOT NULL;
