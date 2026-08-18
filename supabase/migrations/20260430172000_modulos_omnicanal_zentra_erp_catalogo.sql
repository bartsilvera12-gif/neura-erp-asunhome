-- PostgREST del ERP usa db.schema = zentra_erp (src/lib/supabase/schema.ts).
-- 20260430171000 insertó solo en public.modulos → la UI admin no listaba Monitoreo / Historial / Finalizadas.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'zentra_erp' AND table_name = 'modulos'
  ) THEN
    INSERT INTO zentra_erp.modulos (id, nombre, slug)
    SELECT gen_random_uuid(), 'Historial omnicanal', 'historial-omnicanal'
    WHERE NOT EXISTS (SELECT 1 FROM zentra_erp.modulos WHERE slug = 'historial-omnicanal');

    INSERT INTO zentra_erp.modulos (id, nombre, slug)
    SELECT gen_random_uuid(), 'Conversaciones finalizadas', 'conversaciones-finalizadas'
    WHERE NOT EXISTS (SELECT 1 FROM zentra_erp.modulos WHERE slug = 'conversaciones-finalizadas');

    INSERT INTO zentra_erp.modulos (id, nombre, slug)
    SELECT gen_random_uuid(), 'Monitoreo', 'monitoreo'
    WHERE NOT EXISTS (SELECT 1 FROM zentra_erp.modulos WHERE slug = 'monitoreo');

    INSERT INTO zentra_erp.modulos (id, nombre, slug)
    SELECT gen_random_uuid(), 'Omnicanal (paquete)', 'omnicanal'
    WHERE NOT EXISTS (SELECT 1 FROM zentra_erp.modulos WHERE slug = 'omnicanal');
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'modulos'
  ) THEN
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
  END IF;
END $$;
