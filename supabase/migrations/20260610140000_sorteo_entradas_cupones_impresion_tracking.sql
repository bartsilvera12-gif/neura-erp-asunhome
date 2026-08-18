-- Seguimiento de impresión física de cupones por orden (sorteo_entradas).
-- Misma forma multi-schema que suscripciones plan pendiente.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'sorteo_entradas'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.sorteo_entradas ADD COLUMN IF NOT EXISTS cupones_impresos_at timestamptz',
      r.sch
    );
    EXECUTE format(
      'ALTER TABLE %I.sorteo_entradas ADD COLUMN IF NOT EXISTS cupones_impresos_by uuid',
      r.sch
    );
    EXECUTE format(
      'ALTER TABLE %I.sorteo_entradas ADD COLUMN IF NOT EXISTS cupones_impresion_count integer',
      r.sch
    );
  END LOOP;
END $$;

COMMENT ON COLUMN public.sorteo_entradas.cupones_impresos_at IS
  'Momento en que se confirmó la impresión física de cupones para urna (una vez por orden).';
COMMENT ON COLUMN public.sorteo_entradas.cupones_impresos_by IS
  'Usuario ERP que confirmó la impresión (usuarios.id si disponible; sin FK obligatoria).';
COMMENT ON COLUMN public.sorteo_entradas.cupones_impresion_count IS
  'Cantidad de cupones (filas sorteo_cupones) considerados en la última confirmación de impresión.';
