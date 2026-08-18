-- Contador de regeneración de XML desde estado `rechazado`: altera la semilla de dCodSeg/CDC
-- para evitar reenvío con el mismo Id que un DE ya rechazado por SET.
-- Idempotente: ADD COLUMN IF NOT EXISTS en cada schema que tenga `factura_electronica`.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS s
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'factura_electronica'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.factura_electronica ADD COLUMN IF NOT EXISTS sifen_regeneracion_seq integer NOT NULL DEFAULT 0',
      r.s
    );
    EXECUTE format(
      'COMMENT ON COLUMN %I.factura_electronica.sifen_regeneracion_seq IS %L',
      r.s,
      'Incrementado al regenerar XML desde estado rechazado (nueva semilla dCodSeg / nuevo CDC antes de reenviar a SET).'
    );
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';
