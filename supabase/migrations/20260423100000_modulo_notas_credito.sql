-- Catálogo: módulo independiente "Notas de crédito" (sidebar + gates por slug notas_credito).
-- Sin auto-habilitar en empresa_modulos: el super admin lo activa por empresa en admin.
INSERT INTO public.modulos (id, nombre, slug)
SELECT gen_random_uuid(), 'Notas de crédito', 'notas_credito'
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE slug = 'notas_credito');
