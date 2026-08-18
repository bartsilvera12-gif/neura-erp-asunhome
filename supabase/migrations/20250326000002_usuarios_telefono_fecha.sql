-- Campos usados por el formulario de datos personales en /usuarios
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS telefono text;
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS fecha_nacimiento date;
