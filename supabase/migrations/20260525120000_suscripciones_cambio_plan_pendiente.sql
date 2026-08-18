-- Cambio de plan: planes/precio pendientes a aplicar a partir de una fecha (p. ej. 1° del mes siguiente)
-- (public, zentra_erp, tenant er_* y erp_*).

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'suscripciones'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
  LOOP
    EXECUTE format('ALTER TABLE %I.suscripciones ADD COLUMN IF NOT EXISTS plan_pendiente_id uuid', r.sch);
    EXECUTE format('ALTER TABLE %I.suscripciones ADD COLUMN IF NOT EXISTS precio_pendiente numeric', r.sch);
    EXECUTE format('ALTER TABLE %I.suscripciones ADD COLUMN IF NOT EXISTS moneda_pendiente text', r.sch);
    EXECUTE format('ALTER TABLE %I.suscripciones ADD COLUMN IF NOT EXISTS plan_pendiente_vigente_desde date', r.sch);
  END LOOP;
END $$;

COMMENT ON COLUMN public.suscripciones.plan_pendiente_id IS
  'Plan a aplicar (vigente desde plan_pendiente_vigente_desde).';
COMMENT ON COLUMN public.suscripciones.precio_pendiente IS
  'Precio a aplicar con el plan pendiente.';
COMMENT ON COLUMN public.suscripciones.moneda_pendiente IS
  'Moneda del precio pendiente (GS o USD en aplicación).';
COMMENT ON COLUMN public.suscripciones.plan_pendiente_vigente_desde IS
  'Fecha a partir de la cual aplica el cambio (p. ej. 1° del mes siguiente).';
