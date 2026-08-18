-- =============================================================================
-- Sorteos: numeración opcional de cupones (correlativo / aleatorio con rango).
-- Multi-schema: public, zentra_erp, tenant er_* / erp_*
-- Filas existentes: coupon_numbering_enabled = false (default).
-- =============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'sorteos'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.sorteos ADD COLUMN IF NOT EXISTS coupon_numbering_enabled boolean NOT NULL DEFAULT false',
      r.sch
    );
    EXECUTE format(
      'ALTER TABLE %I.sorteos ADD COLUMN IF NOT EXISTS coupon_number_start integer',
      r.sch
    );
    EXECUTE format(
      'ALTER TABLE %I.sorteos ADD COLUMN IF NOT EXISTS coupon_number_mode text',
      r.sch
    );
    EXECUTE format(
      'ALTER TABLE %I.sorteos ADD COLUMN IF NOT EXISTS coupon_number_limit integer',
      r.sch
    );
    BEGIN
      EXECUTE format(
        $f$
        ALTER TABLE %I.sorteos DROP CONSTRAINT IF EXISTS sorteos_coupon_number_mode_check;
        ALTER TABLE %I.sorteos ADD CONSTRAINT sorteos_coupon_number_mode_check
          CHECK (coupon_number_mode IS NULL OR coupon_number_mode IN ('correlative', 'random'))
        $f$,
        r.sch,
        r.sch
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'sorteos coupon_number_mode check [%]: %', r.sch, SQLERRM;
    END;
  END LOOP;
END;
$$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'sorteo_cupones'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.sorteo_cupones ADD COLUMN IF NOT EXISTS coupon_number_value integer',
      r.sch
    );
    EXECUTE format(
      $f$
      CREATE UNIQUE INDEX IF NOT EXISTS uq_sorteo_cupones_sorteo_coupon_value
        ON %I.sorteo_cupones (sorteo_id, coupon_number_value)
        WHERE coupon_number_value IS NOT NULL
      $f$,
      r.sch
    );
  END LOOP;
END;
$$;
