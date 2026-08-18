-- Configuración explícita SIFEN del receptor (DE factura electrónica), opcional por cliente.
-- Si sifen_receptor_manual = false, el ERP sigue la lógica histórica (RUC/CI/extranjero boolean).
-- Idempotente: ADD COLUMN IF NOT EXISTS en todos los schemas con `clientes`.

DO $$
DECLARE
  r RECORD;
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
    EXECUTE format(
      $q$
        ALTER TABLE %I.clientes ADD COLUMN IF NOT EXISTS sifen_receptor_manual boolean NOT NULL DEFAULT false;
        ALTER TABLE %I.clientes ADD COLUMN IF NOT EXISTS sifen_receptor_naturaleza text NULL;
        ALTER TABLE %I.clientes ADD COLUMN IF NOT EXISTS sifen_ti_ope smallint NULL;
        ALTER TABLE %I.clientes ADD COLUMN IF NOT EXISTS sifen_num_id_de text NULL;
        ALTER TABLE %I.clientes ADD COLUMN IF NOT EXISTS sifen_direccion_de text NULL;
        ALTER TABLE %I.clientes ADD COLUMN IF NOT EXISTS sifen_num_casa_de integer NULL;
        ALTER TABLE %I.clientes ADD COLUMN IF NOT EXISTS sifen_descripcion_tipo_doc text NULL;
      $q$,
      r.s, r.s, r.s, r.s, r.s, r.s, r.s, r.s
    );
    EXECUTE format(
      $c$
        ALTER TABLE %I.clientes DROP CONSTRAINT IF EXISTS clientes_sifen_receptor_naturaleza_check;
        ALTER TABLE %I.clientes
          ADD CONSTRAINT clientes_sifen_receptor_naturaleza_check
          CHECK (
            sifen_receptor_naturaleza IS NULL
            OR sifen_receptor_naturaleza IN ('contribuyente_paraguayo', 'no_contribuyente', 'extranjero')
          );
      $c$,
      r.s,
      r.s
    );
    EXECUTE format(
      $d$
        ALTER TABLE %I.clientes DROP CONSTRAINT IF EXISTS clientes_sifen_ti_ope_check;
        ALTER TABLE %I.clientes
          ADD CONSTRAINT clientes_sifen_ti_ope_check
          CHECK (sifen_ti_ope IS NULL OR (sifen_ti_ope >= 1 AND sifen_ti_ope <= 4));
      $d$,
      r.s,
      r.s
    );
    EXECUTE format(
      'COMMENT ON COLUMN %I.clientes.sifen_receptor_manual IS %L',
      r.s,
      'Si true, gDatRec del DE usa sifen_receptor_naturaleza, sifen_ti_ope y campos DE explícitos (sin inferencia legacy).'
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
