-- Columnas mínimas para receptor extranjero en DE SIFEN (factura electrónica).
-- Idempotente: ADD COLUMN IF NOT EXISTS en todos los schemas que tienen `clientes`.
--
-- Uso:
--   sifen_receptor_extranjero: si true, el XML no usa dRucRec/dDVRec paraguayos.
--   sifen_codigo_pais: ISO 3166-1 alpha-3 (ej. PER); alternativa a inferir desde `pais`.
--   sifen_tipo_doc_receptor: tiTipDocRec SET (1–6 o 9); null → 9 en runtime para extranjeros.

DO $$
DECLARE
  r   RECORD;
  sch text;
BEGIN
  FOR r IN
    SELECT n.nspname AS s
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'clientes'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
  LOOP
    sch := r.s;
    EXECUTE format(
      $q$
        ALTER TABLE %I.clientes ADD COLUMN IF NOT EXISTS sifen_receptor_extranjero boolean NOT NULL DEFAULT false;
        ALTER TABLE %I.clientes ADD COLUMN IF NOT EXISTS sifen_codigo_pais text NULL;
        ALTER TABLE %I.clientes ADD COLUMN IF NOT EXISTS sifen_tipo_doc_receptor smallint NULL;
      $q$,
      sch,
      sch,
      sch
    );
  END LOOP;
END $$;
