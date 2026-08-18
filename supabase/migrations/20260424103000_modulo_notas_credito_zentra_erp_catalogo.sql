-- El cliente Supabase del ERP usa db.schema = zentra_erp (ver src/lib/supabase/schema.ts).
-- La migración 20260423100000 insertó solo en public.modulos; PostgREST lee zentra_erp.modulos
-- → el módulo no aparecía en Admin / Módulos habilitados.
-- Idempotente: inserta donde exista la tabla y falte el slug.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'zentra_erp' AND table_name = 'modulos'
  ) THEN
    INSERT INTO zentra_erp.modulos (id, nombre, slug)
    SELECT gen_random_uuid(), 'Notas de crédito', 'notas_credito'
    WHERE NOT EXISTS (SELECT 1 FROM zentra_erp.modulos WHERE slug = 'notas_credito');
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'modulos'
  ) THEN
    INSERT INTO public.modulos (id, nombre, slug)
    SELECT gen_random_uuid(), 'Notas de crédito', 'notas_credito'
    WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE slug = 'notas_credito');
  END IF;
END $$;
