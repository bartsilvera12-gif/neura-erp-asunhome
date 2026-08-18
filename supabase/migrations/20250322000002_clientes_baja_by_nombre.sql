-- Nombre del usuario que dio de baja (para trazabilidad)
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS baja_operativa_by_nombre text;
