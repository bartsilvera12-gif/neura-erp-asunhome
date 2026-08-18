-- =============================================================================
-- Pagos: trazabilidad, cliente_id, usuario_id - Neura ERP
-- NO destructivo: solo agrega columnas
-- =============================================================================

-- 1. Agregar columnas si no existen
ALTER TABLE public.pagos
  ADD COLUMN IF NOT EXISTS cliente_id uuid,
  ADD COLUMN IF NOT EXISTS usuario_id uuid;

-- created_at ya existe en la tabla original; no se agrega

-- 2. FK cliente_id → clientes (sin ON DELETE para no romper integridad)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'pagos_cliente_id_fkey'
    AND table_name = 'pagos'
  ) THEN
    ALTER TABLE public.pagos
      ADD CONSTRAINT pagos_cliente_id_fkey
      FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 3. FK usuario_id → auth.users (usuario que registró)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'pagos_usuario_id_fkey'
    AND table_name = 'pagos'
  ) THEN
    ALTER TABLE public.pagos
      ADD CONSTRAINT pagos_usuario_id_fkey
      FOREIGN KEY (usuario_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 4. Índices para consultas
CREATE INDEX IF NOT EXISTS idx_pagos_cliente ON public.pagos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_pagos_usuario ON public.pagos(usuario_id);

-- 5. Backfill: poblar cliente_id desde facturas para registros existentes
UPDATE public.pagos p
SET cliente_id = f.cliente_id
FROM public.facturas f
WHERE p.factura_id = f.id
  AND p.cliente_id IS NULL;
