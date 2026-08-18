-- =============================================================================
-- Clientes: trazabilidad, tipo_servicio, eliminación lógica - Neura ERP
-- No destructivo: solo agrega columnas y ajusta políticas
-- =============================================================================

-- 1. Trazabilidad de creación
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'clientes_created_by_user_id_fkey'
    AND table_name = 'clientes'
  ) THEN
    ALTER TABLE public.clientes
      ADD CONSTRAINT clientes_created_by_user_id_fkey
      FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_clientes_created_by ON public.clientes(created_by_user_id);

-- Nombre del creador para display (denormalizado)
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS created_by_nombre text;

-- 2. Clasificación operativa (distinta de tipo_cliente)
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS tipo_servicio_cliente text;

-- Constraint CHECK para valores controlados
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clientes_tipo_servicio_cliente_check'
  ) THEN
    ALTER TABLE public.clientes
      ADD CONSTRAINT clientes_tipo_servicio_cliente_check
      CHECK (tipo_servicio_cliente IS NULL OR tipo_servicio_cliente IN (
        'marketing', 'saas', 'branding', 'web', 'otro'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_clientes_tipo_servicio ON public.clientes(tipo_servicio_cliente)
  WHERE tipo_servicio_cliente IS NOT NULL;

-- 3. Eliminación lógica (soft delete)
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS deletion_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'clientes_deleted_by_user_id_fkey'
    AND table_name = 'clientes'
  ) THEN
    ALTER TABLE public.clientes
      ADD CONSTRAINT clientes_deleted_by_user_id_fkey
      FOREIGN KEY (deleted_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_clientes_deleted_at ON public.clientes(deleted_at)
  WHERE deleted_at IS NOT NULL;

-- Las políticas RLS existentes permiten SELECT/UPDATE en filas de la empresa.
-- La exclusión de eliminados se hace en la capa de aplicación (.is("deleted_at", null)).
-- No se modifica la política DELETE: la eliminación física queda restringida;
-- la baja lógica se hace con UPDATE.
