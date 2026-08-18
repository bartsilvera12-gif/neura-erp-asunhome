-- =============================================================================
-- Sorteos: metadatos venta manual ERP (mostrador / efectivo). Réplica multi-schema.
-- =============================================================================

ALTER TABLE public.sorteo_entradas
  ADD COLUMN IF NOT EXISTS observacion_interna text,
  ADD COLUMN IF NOT EXISTS venta_origen text,
  ADD COLUMN IF NOT EXISTS venta_canal text,
  ADD COLUMN IF NOT EXISTS pago_metodo text;

ALTER TABLE public.sorteo_entradas
  DROP CONSTRAINT IF EXISTS sorteo_entradas_venta_origen_check;
ALTER TABLE public.sorteo_entradas
  ADD CONSTRAINT sorteo_entradas_venta_origen_check
  CHECK (venta_origen IS NULL OR venta_origen IN ('whatsapp_flow', 'erp_manual'));

ALTER TABLE public.sorteo_entradas
  DROP CONSTRAINT IF EXISTS sorteo_entradas_venta_canal_check;
ALTER TABLE public.sorteo_entradas
  ADD CONSTRAINT sorteo_entradas_venta_canal_check
  CHECK (venta_canal IS NULL OR venta_canal IN ('remote', 'local'));

ALTER TABLE public.sorteo_entradas
  DROP CONSTRAINT IF EXISTS sorteo_entradas_pago_metodo_check;
ALTER TABLE public.sorteo_entradas
  ADD CONSTRAINT sorteo_entradas_pago_metodo_check
  CHECK (pago_metodo IS NULL OR pago_metodo IN ('efectivo', 'transferencia', 'tarjeta', 'otro'));

COMMENT ON COLUMN public.sorteo_entradas.observacion_interna IS
  'Nota interna ERP (no visible al comprador).';
COMMENT ON COLUMN public.sorteo_entradas.venta_origen IS
  'whatsapp_flow: flujo WhatsApp; erp_manual: carga manual en panel.';
COMMENT ON COLUMN public.sorteo_entradas.venta_canal IS
  'remote: compra remota; local: mostrador/presencial.';
COMMENT ON COLUMN public.sorteo_entradas.pago_metodo IS
  'Medio de pago declarado en venta manual o registro interno.';

-- Plantilla zentra_erp
ALTER TABLE zentra_erp.sorteo_entradas
  ADD COLUMN IF NOT EXISTS observacion_interna text,
  ADD COLUMN IF NOT EXISTS venta_origen text,
  ADD COLUMN IF NOT EXISTS venta_canal text,
  ADD COLUMN IF NOT EXISTS pago_metodo text;

ALTER TABLE zentra_erp.sorteo_entradas
  DROP CONSTRAINT IF EXISTS sorteo_entradas_venta_origen_check;
ALTER TABLE zentra_erp.sorteo_entradas
  ADD CONSTRAINT sorteo_entradas_venta_origen_check
  CHECK (venta_origen IS NULL OR venta_origen IN ('whatsapp_flow', 'erp_manual'));

ALTER TABLE zentra_erp.sorteo_entradas
  DROP CONSTRAINT IF EXISTS sorteo_entradas_venta_canal_check;
ALTER TABLE zentra_erp.sorteo_entradas
  ADD CONSTRAINT sorteo_entradas_venta_canal_check
  CHECK (venta_canal IS NULL OR venta_canal IN ('remote', 'local'));

ALTER TABLE zentra_erp.sorteo_entradas
  DROP CONSTRAINT IF EXISTS sorteo_entradas_pago_metodo_check;
ALTER TABLE zentra_erp.sorteo_entradas
  ADD CONSTRAINT sorteo_entradas_pago_metodo_check
  CHECK (pago_metodo IS NULL OR pago_metodo IN ('efectivo', 'transferencia', 'tarjeta', 'otro'));

-- Schemas tenant erp_* / er_*
DO $$
DECLARE
  sch text;
  sql text;
BEGIN
  FOR sch IN
    SELECT nspname::text
    FROM pg_namespace
    WHERE (nspname ~ '^erp_[a-zA-Z0-9_]+$' OR nspname ~ '^er_[0-9a-f]{32}$')
      AND EXISTS (
        SELECT 1 FROM information_schema.tables t
        WHERE t.table_schema = nspname AND t.table_name = 'sorteo_entradas'
      )
  LOOP
    sql := format(
      $f$
      ALTER TABLE %I.sorteo_entradas
        ADD COLUMN IF NOT EXISTS observacion_interna text,
        ADD COLUMN IF NOT EXISTS venta_origen text,
        ADD COLUMN IF NOT EXISTS venta_canal text,
        ADD COLUMN IF NOT EXISTS pago_metodo text;
      ALTER TABLE %I.sorteo_entradas DROP CONSTRAINT IF EXISTS sorteo_entradas_venta_origen_check;
      ALTER TABLE %I.sorteo_entradas ADD CONSTRAINT sorteo_entradas_venta_origen_check
        CHECK (venta_origen IS NULL OR venta_origen IN (''whatsapp_flow'', ''erp_manual''));
      ALTER TABLE %I.sorteo_entradas DROP CONSTRAINT IF EXISTS sorteo_entradas_venta_canal_check;
      ALTER TABLE %I.sorteo_entradas ADD CONSTRAINT sorteo_entradas_venta_canal_check
        CHECK (venta_canal IS NULL OR venta_canal IN (''remote'', ''local''));
      ALTER TABLE %I.sorteo_entradas DROP CONSTRAINT IF EXISTS sorteo_entradas_pago_metodo_check;
      ALTER TABLE %I.sorteo_entradas ADD CONSTRAINT sorteo_entradas_pago_metodo_check
        CHECK (pago_metodo IS NULL OR pago_metodo IN (''efectivo'', ''transferencia'', ''tarjeta'', ''otro''));
      $f$,
      sch, sch, sch, sch, sch, sch, sch
    );
    BEGIN
      EXECUTE sql;
    EXCEPTION WHEN undefined_table THEN
      RAISE NOTICE 'sorteo_entradas manual meta skipped for schema %', sch;
    END;
  END LOOP;
END;
$$;
