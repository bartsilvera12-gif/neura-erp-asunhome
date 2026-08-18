-- Añadir columna plan a empresas (opcional para SaaS)
ALTER TABLE public.empresas ADD COLUMN IF NOT EXISTS plan text;
