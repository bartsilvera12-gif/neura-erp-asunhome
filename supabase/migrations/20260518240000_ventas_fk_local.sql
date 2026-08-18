-- =============================================================================
-- Fix: ventas y ventas_items en tenants tienen FKs apuntando a zentra_erp.*
-- (productos, ventas, clientes) en lugar del schema local. Resultado:
-- al insertar ventas_items con producto_id de erp_xxx.productos falla con
-- 23503 ventas_items_producto_id_fkey.
--
-- Reglas: aditiva multi-schema; solo retargetea las FKs locales; antes de
-- recrear cada FK valida que no haya filas huerfanas en la tabla local
-- correspondiente. Si las hay, NO recrea esa FK y emite NOTICE.
--
-- empresa_id se deja apuntando a zentra_erp.empresas (catalogo central),
-- como en el resto del repo.
-- =============================================================================

DO $$
DECLARE
  r RECORD;
  orphans int;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'ventas_items'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
  LOOP
    RAISE NOTICE '[ventas FK local] schema=%', r.sch;

    -- ── ventas_items.producto_id → {schema}.productos ───────────────────
    EXECUTE format(
      'SELECT count(*)::int FROM %I.ventas_items vi
         WHERE vi.producto_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM %I.productos p WHERE p.id = vi.producto_id)',
      r.sch, r.sch
    ) INTO orphans;
    IF orphans > 0 THEN
      RAISE NOTICE '  ventas_items.producto_id: % huerfanas en %, NO se recrea FK', orphans, r.sch;
    ELSE
      BEGIN
        EXECUTE format(
          'ALTER TABLE %I.ventas_items DROP CONSTRAINT IF EXISTS ventas_items_producto_id_fkey',
          r.sch
        );
        EXECUTE format(
          'ALTER TABLE %I.ventas_items
             ADD CONSTRAINT ventas_items_producto_id_fkey
             FOREIGN KEY (producto_id) REFERENCES %I.productos(id) ON DELETE RESTRICT',
          r.sch, r.sch
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '  ventas_items.producto_id fk en %: %', r.sch, SQLERRM;
      END;
    END IF;

    -- ── ventas_items.venta_id → {schema}.ventas ─────────────────────────
    EXECUTE format(
      'SELECT count(*)::int FROM %I.ventas_items vi
         WHERE vi.venta_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM %I.ventas v WHERE v.id = vi.venta_id)',
      r.sch, r.sch
    ) INTO orphans;
    IF orphans > 0 THEN
      RAISE NOTICE '  ventas_items.venta_id: % huerfanas en %, NO se recrea FK', orphans, r.sch;
    ELSE
      BEGIN
        EXECUTE format(
          'ALTER TABLE %I.ventas_items DROP CONSTRAINT IF EXISTS ventas_items_venta_id_fkey',
          r.sch
        );
        EXECUTE format(
          'ALTER TABLE %I.ventas_items
             ADD CONSTRAINT ventas_items_venta_id_fkey
             FOREIGN KEY (venta_id) REFERENCES %I.ventas(id) ON DELETE CASCADE',
          r.sch, r.sch
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '  ventas_items.venta_id fk en %: %', r.sch, SQLERRM;
      END;
    END IF;

    -- ── ventas.cliente_id → {schema}.clientes (solo si tabla clientes existe) ──
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
               WHERE n.nspname=r.sch AND c.relname='clientes' AND c.relkind='r') THEN
      EXECUTE format(
        'SELECT count(*)::int FROM %I.ventas v
           WHERE v.cliente_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM %I.clientes cl WHERE cl.id = v.cliente_id)',
        r.sch, r.sch
      ) INTO orphans;
      IF orphans > 0 THEN
        RAISE NOTICE '  ventas.cliente_id: % huerfanas en %, NO se recrea FK', orphans, r.sch;
      ELSE
        BEGIN
          EXECUTE format(
            'ALTER TABLE %I.ventas DROP CONSTRAINT IF EXISTS ventas_cliente_id_fkey',
            r.sch
          );
          EXECUTE format(
            'ALTER TABLE %I.ventas
               ADD CONSTRAINT ventas_cliente_id_fkey
               FOREIGN KEY (cliente_id) REFERENCES %I.clientes(id) ON DELETE SET NULL',
            r.sch, r.sch
          );
        EXCEPTION WHEN OTHERS THEN
          RAISE NOTICE '  ventas.cliente_id fk en %: %', r.sch, SQLERRM;
        END;
      END IF;
    END IF;

    -- ── empresa_id de ventas y ventas_items: dejar apuntando a zentra_erp.empresas
    --    (mismo patron que productos/compras/movimientos). Solo asegurar que es asi.
    BEGIN
      EXECUTE format('ALTER TABLE %I.ventas DROP CONSTRAINT IF EXISTS ventas_empresa_id_fkey', r.sch);
      EXECUTE format(
        'ALTER TABLE %I.ventas ADD CONSTRAINT ventas_empresa_id_fkey
           FOREIGN KEY (empresa_id) REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE',
        r.sch
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '  ventas.empresa_id en %: %', r.sch, SQLERRM;
    END;
    BEGIN
      EXECUTE format('ALTER TABLE %I.ventas_items DROP CONSTRAINT IF EXISTS ventas_items_empresa_id_fkey', r.sch);
      EXECUTE format(
        'ALTER TABLE %I.ventas_items ADD CONSTRAINT ventas_items_empresa_id_fkey
           FOREIGN KEY (empresa_id) REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE',
        r.sch
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '  ventas_items.empresa_id en %: %', r.sch, SQLERRM;
    END;
  END LOOP;
END;
$$;
