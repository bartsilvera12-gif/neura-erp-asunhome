-- Insertar módulo Pagos en el catálogo si no existe
INSERT INTO public.modulos (id, nombre, slug)
SELECT gen_random_uuid(), 'Pagos', 'pagos'
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE slug = 'pagos');

-- Habilitar módulo Pagos para todas las empresas existentes
INSERT INTO public.empresa_modulos (empresa_id, modulo_id, activo)
SELECT e.id, m.id, true
FROM public.empresas e
CROSS JOIN public.modulos m
WHERE m.slug = 'pagos'
  AND NOT EXISTS (
    SELECT 1 FROM public.empresa_modulos em
    WHERE em.empresa_id = e.id AND em.modulo_id = m.id
  );
