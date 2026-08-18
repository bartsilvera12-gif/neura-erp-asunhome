-- Ventas DB-first: trazabilidad movimientos ↔ venta + observaciones en cabecera.
-- Aplica en zentra_erp, public (legacy) y esquemas tenant erp_* / er_*.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'ventas'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.ventas ADD COLUMN IF NOT EXISTS observaciones text',
      r.sch
    );
  END LOOP;

  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'movimientos_inventario'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.movimientos_inventario ADD COLUMN IF NOT EXISTS venta_id uuid',
      r.sch
    );
  END LOOP;

  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'movimientos_inventario'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER TABLE %I.movimientos_inventario ADD CONSTRAINT movimientos_inventario_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES %I.ventas(id) ON DELETE SET NULL',
        r.sch,
        r.sch
      );
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_movimientos_venta ON %I.movimientos_inventario(venta_id)',
      r.sch
    );
  END LOOP;
END;
$$;
