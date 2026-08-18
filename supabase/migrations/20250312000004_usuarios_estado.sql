-- Añadir columna estado a usuarios (activo/inactivo)
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo'));
