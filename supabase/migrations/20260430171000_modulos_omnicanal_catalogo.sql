-- Submódulos omnicanal / dashboard: deben existir en public.modulos para que el superadmin
-- pueda habilitarlos al crear empresa (API /api/admin/modulos).

INSERT INTO public.modulos (id, nombre, slug)
SELECT gen_random_uuid(), 'Historial omnicanal', 'historial-omnicanal'
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE slug = 'historial-omnicanal');

INSERT INTO public.modulos (id, nombre, slug)
SELECT gen_random_uuid(), 'Conversaciones finalizadas', 'conversaciones-finalizadas'
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE slug = 'conversaciones-finalizadas');

INSERT INTO public.modulos (id, nombre, slug)
SELECT gen_random_uuid(), 'Monitoreo', 'monitoreo'
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE slug = 'monitoreo');

INSERT INTO public.modulos (id, nombre, slug)
SELECT gen_random_uuid(), 'Omnicanal (paquete)', 'omnicanal'
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE slug = 'omnicanal');
