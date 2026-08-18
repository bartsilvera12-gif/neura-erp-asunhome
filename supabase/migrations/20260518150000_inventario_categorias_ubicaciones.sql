-- =============================================================================
-- F4 — Inventario maestro: categorias de productos + ubicaciones fisicas
--
-- Tablas nuevas (4) en cada schema con `productos`:
--   categorias_productos          (maestro de categorias de productos)
--   producto_categorias           (puente N:N producto<->categoria, es_principal)
--   inventario_ubicaciones        (maestro de depositos/salones/pasillos/etc.)
--   inventario_stock_ubicacion    (stock por ubicacion, opcional)
--
-- Columnas nuevas en productos:
--   categoria_principal_id        (FK opcional)
--   ubicacion_principal_id        (FK opcional)
--
-- Reglas:
--   - IF NOT EXISTS en TODO. Aditivo. Idempotente.
--   - FKs LOCALES al mismo schema cuando referencian tablas tenant
--     (productos, proveedores, categorias_productos, inventario_ubicaciones).
--   - empresa_id referencia zentra_erp.empresas (igual que las extensiones
--     proveedores ya hechas en 20260518120000).
--   - NO toca proveedor_productos ni proveedor_categorias existentes.
--   - NO toca movimientos_inventario (ubicacion en movimientos queda
--     pendiente de una fase posterior).
-- =============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'productos'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
  LOOP
    RAISE NOTICE '[F4 inventario maestro] schema: %', r.sch;

    -- ── 1) categorias_productos ─────────────────────────────────────────
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I.categorias_productos (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id   uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
        nombre       text NOT NULL,
        codigo       text,
        descripcion  text,
        parent_id    uuid REFERENCES %I.categorias_productos(id) ON DELETE SET NULL,
        activo       boolean NOT NULL DEFAULT true,
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now()
      )
    $f$, r.sch, r.sch);

    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_categorias_productos_empresa ON %I.categorias_productos(empresa_id)', r.sch);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_categorias_productos_parent  ON %I.categorias_productos(parent_id)', r.sch);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_categorias_productos_activo  ON %I.categorias_productos(activo)', r.sch);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_categorias_productos_nombre  ON %I.categorias_productos(nombre)', r.sch);
    EXECUTE format($f$
      CREATE UNIQUE INDEX IF NOT EXISTS uq_categorias_productos_empresa_nombre
        ON %I.categorias_productos (empresa_id, lower(trim(nombre)))
    $f$, r.sch);

    -- ── 2) producto_categorias (puente N:N) ─────────────────────────────
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I.producto_categorias (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id    uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
        producto_id   uuid NOT NULL REFERENCES %I.productos(id) ON DELETE CASCADE,
        categoria_id  uuid NOT NULL REFERENCES %I.categorias_productos(id) ON DELETE CASCADE,
        es_principal  boolean NOT NULL DEFAULT false,
        created_at    timestamptz NOT NULL DEFAULT now()
      )
    $f$, r.sch, r.sch, r.sch);

    EXECUTE format($f$
      CREATE UNIQUE INDEX IF NOT EXISTS uq_producto_categorias_triple
        ON %I.producto_categorias (empresa_id, producto_id, categoria_id)
    $f$, r.sch);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_producto_categorias_producto ON %I.producto_categorias(producto_id)', r.sch);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_producto_categorias_categoria ON %I.producto_categorias(categoria_id)', r.sch);
    EXECUTE format($f$
      CREATE UNIQUE INDEX IF NOT EXISTS uq_producto_categoria_principal_unica
        ON %I.producto_categorias (empresa_id, producto_id)
        WHERE es_principal = true
    $f$, r.sch);

    -- ── 3) inventario_ubicaciones ────────────────────────────────────────
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I.inventario_ubicaciones (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id   uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
        nombre       text NOT NULL,
        codigo       text,
        tipo         text NOT NULL DEFAULT 'deposito'
                     CHECK (tipo IN ('deposito','salon','pasillo','gondola','estante','zona','otro')),
        parent_id    uuid REFERENCES %I.inventario_ubicaciones(id) ON DELETE SET NULL,
        descripcion  text,
        activo       boolean NOT NULL DEFAULT true,
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now()
      )
    $f$, r.sch, r.sch);

    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_ubicaciones_empresa ON %I.inventario_ubicaciones(empresa_id)', r.sch);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_ubicaciones_parent  ON %I.inventario_ubicaciones(parent_id)', r.sch);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_ubicaciones_tipo    ON %I.inventario_ubicaciones(tipo)', r.sch);
    EXECUTE format($f$
      CREATE UNIQUE INDEX IF NOT EXISTS uq_ubicaciones_empresa_codigo
        ON %I.inventario_ubicaciones (empresa_id, lower(trim(codigo)))
        WHERE codigo IS NOT NULL AND trim(codigo) <> ''
    $f$, r.sch);

    -- ── 4) inventario_stock_ubicacion ────────────────────────────────────
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I.inventario_stock_ubicacion (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id    uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
        producto_id   uuid NOT NULL REFERENCES %I.productos(id) ON DELETE CASCADE,
        ubicacion_id  uuid NOT NULL REFERENCES %I.inventario_ubicaciones(id) ON DELETE CASCADE,
        stock_actual  numeric NOT NULL DEFAULT 0,
        stock_minimo  numeric,
        stock_maximo  numeric,
        es_principal  boolean NOT NULL DEFAULT false,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now()
      )
    $f$, r.sch, r.sch, r.sch);

    EXECUTE format($f$
      CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_ubicacion_triple
        ON %I.inventario_stock_ubicacion (empresa_id, producto_id, ubicacion_id)
    $f$, r.sch);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_stock_ubic_producto ON %I.inventario_stock_ubicacion(producto_id)', r.sch);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_stock_ubic_ubicacion ON %I.inventario_stock_ubicacion(ubicacion_id)', r.sch);
    EXECUTE format($f$
      CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_ubicacion_principal_unica
        ON %I.inventario_stock_ubicacion (empresa_id, producto_id)
        WHERE es_principal = true
    $f$, r.sch);

    -- ── 5) Columnas nuevas en productos ─────────────────────────────────
    EXECUTE format($f$
      ALTER TABLE %I.productos
        ADD COLUMN IF NOT EXISTS categoria_principal_id uuid,
        ADD COLUMN IF NOT EXISTS ubicacion_principal_id uuid
    $f$, r.sch);

    -- FKs (drop+add seguro porque la columna es nueva o sin constraint)
    BEGIN
      EXECUTE format('ALTER TABLE %I.productos DROP CONSTRAINT IF EXISTS productos_categoria_principal_id_fkey', r.sch);
      EXECUTE format($f$
        ALTER TABLE %I.productos
          ADD CONSTRAINT productos_categoria_principal_id_fkey
          FOREIGN KEY (categoria_principal_id)
          REFERENCES %I.categorias_productos(id) ON DELETE SET NULL
      $f$, r.sch, r.sch);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'productos.categoria_principal_id fk en %: %', r.sch, SQLERRM;
    END;

    BEGIN
      EXECUTE format('ALTER TABLE %I.productos DROP CONSTRAINT IF EXISTS productos_ubicacion_principal_id_fkey', r.sch);
      EXECUTE format($f$
        ALTER TABLE %I.productos
          ADD CONSTRAINT productos_ubicacion_principal_id_fkey
          FOREIGN KEY (ubicacion_principal_id)
          REFERENCES %I.inventario_ubicaciones(id) ON DELETE SET NULL
      $f$, r.sch, r.sch);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'productos.ubicacion_principal_id fk en %: %', r.sch, SQLERRM;
    END;
  END LOOP;
END;
$$;
