-- =============================================================================
-- Fix: compras en tenants tiene FK producto_id y proveedor_id apuntando a
-- zentra_erp (incorrecto) — todo INSERT falla con FK violation.
-- Reescribir a las tablas LOCALES del mismo schema + columnas de auditoria.
-- =============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'compras'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
  LOOP
    RAISE NOTICE '[compras fix-fks+auditoria] schema=%', r.sch;

    -- Columnas auditoria
    EXECUTE format(
      'ALTER TABLE %I.compras
         ADD COLUMN IF NOT EXISTS created_by uuid,
         ADD COLUMN IF NOT EXISTS usuario_nombre text',
      r.sch
    );

    -- FK producto_id local
    BEGIN
      EXECUTE format('ALTER TABLE %I.compras DROP CONSTRAINT IF EXISTS compras_producto_id_fkey', r.sch);
      EXECUTE format(
        'ALTER TABLE %I.compras
           ADD CONSTRAINT compras_producto_id_fkey
           FOREIGN KEY (producto_id) REFERENCES %I.productos(id) ON DELETE RESTRICT',
        r.sch, r.sch
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'compras FK producto_id en %: %', r.sch, SQLERRM;
    END;

    -- FK proveedor_id local
    BEGIN
      EXECUTE format('ALTER TABLE %I.compras DROP CONSTRAINT IF EXISTS compras_proveedor_id_fkey', r.sch);
      EXECUTE format(
        'ALTER TABLE %I.compras
           ADD CONSTRAINT compras_proveedor_id_fkey
           FOREIGN KEY (proveedor_id) REFERENCES %I.proveedores(id) ON DELETE RESTRICT',
        r.sch, r.sch
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'compras FK proveedor_id en %: %', r.sch, SQLERRM;
    END;

    -- FK empresa_id -> zentra_erp.empresas (catalogo) en tenants
    IF r.sch NOT IN ('public') THEN
      BEGIN
        EXECUTE format('ALTER TABLE %I.compras DROP CONSTRAINT IF EXISTS compras_empresa_id_fkey', r.sch);
        EXECUTE format(
          'ALTER TABLE %I.compras
             ADD CONSTRAINT compras_empresa_id_fkey
             FOREIGN KEY (empresa_id) REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE',
          r.sch
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'compras FK empresa_id en %: %', r.sch, SQLERRM;
      END;
    END IF;

    -- Indices auditoria + busqueda
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_compras_created_by ON %I.compras (created_by)', r.sch);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_compras_empresa_fecha ON %I.compras (empresa_id, fecha DESC)', r.sch);
    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_compras_empresa_numero_control
         ON %I.compras (empresa_id, numero_control)',
      r.sch
    );
  END LOOP;
END;
$$;
