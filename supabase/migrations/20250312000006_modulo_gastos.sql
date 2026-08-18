-- Insertar módulo Gastos en el catálogo si no existe
INSERT INTO public.modulos (id, nombre, slug)
SELECT gen_random_uuid(), 'Gastos', 'gastos'
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE slug = 'gastos');
