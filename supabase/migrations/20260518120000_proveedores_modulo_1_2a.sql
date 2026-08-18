-- BLOQUE 1.2A: proveedores extendidos, categorías, rel N:N, vínculo producto–proveedor.
-- Esquemas: zentra_erp, public (legacy), tenant erp_* / er_*.

-- -----------------------------------------------------------------------------
-- 1) Columnas extra en proveedores
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'proveedores'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.proveedores ADD COLUMN IF NOT EXISTS nombre_comercial text',
      r.sch
    );
    EXECUTE format(
      'ALTER TABLE %I.proveedores ADD COLUMN IF NOT EXISTS razon_social text',
      r.sch
    );
    EXECUTE format(
      'ALTER TABLE %I.proveedores ADD COLUMN IF NOT EXISTS condicion_pago text',
      r.sch
    );
    EXECUTE format(
      'ALTER TABLE %I.proveedores ADD COLUMN IF NOT EXISTS plazo_pago_dias integer',
      r.sch
    );
    EXECUTE format(
      'ALTER TABLE %I.proveedores ADD COLUMN IF NOT EXISTS moneda_preferida text',
      r.sch
    );
    EXECUTE format(
      'ALTER TABLE %I.proveedores ADD COLUMN IF NOT EXISTS observaciones text',
      r.sch
    );
    BEGIN
      EXECUTE format(
        $f$
        ALTER TABLE %I.proveedores DROP CONSTRAINT IF EXISTS proveedores_condicion_pago_check;
        ALTER TABLE %I.proveedores ADD CONSTRAINT proveedores_condicion_pago_check
          CHECK (condicion_pago IS NULL OR condicion_pago IN ('contado', 'credito', 'mixto'))
        $f$,
        r.sch,
        r.sch
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'proveedores condicion_pago check: %', SQLERRM;
    END;
    BEGIN
      EXECUTE format(
        $f$
        ALTER TABLE %I.proveedores DROP CONSTRAINT IF EXISTS proveedores_moneda_preferida_check;
        ALTER TABLE %I.proveedores ADD CONSTRAINT proveedores_moneda_preferida_check
          CHECK (moneda_preferida IS NULL OR moneda_preferida IN ('GS', 'USD'))
        $f$,
        r.sch,
        r.sch
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'proveedores moneda_preferida check: %', SQLERRM;
    END;
  END LOOP;
END;
$$;

-- -----------------------------------------------------------------------------
-- 2) Proveedor principal en productos + tabla puente proveedor_productos
-- -----------------------------------------------------------------------------
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
    EXECUTE format(
      'ALTER TABLE %I.productos ADD COLUMN IF NOT EXISTS proveedor_principal_id uuid',
      r.sch
    );
    BEGIN
      EXECUTE format(
        'ALTER TABLE %I.productos DROP CONSTRAINT IF EXISTS productos_proveedor_principal_id_fkey',
        r.sch
      );
      EXECUTE format(
        'ALTER TABLE %I.productos ADD CONSTRAINT productos_proveedor_principal_id_fkey
         FOREIGN KEY (proveedor_principal_id) REFERENCES %I.proveedores(id) ON DELETE SET NULL',
        r.sch,
        r.sch
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'productos proveedor_principal_id fk %: %', r.sch, SQLERRM;
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
    WHERE c.relname = 'proveedores'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = r.sch AND table_name = 'proveedor_productos'
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format($sql$
      CREATE TABLE %I.proveedor_productos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
        producto_id uuid NOT NULL REFERENCES %I.productos(id) ON DELETE CASCADE,
        proveedor_id uuid NOT NULL REFERENCES %I.proveedores(id) ON DELETE CASCADE,
        es_principal boolean NOT NULL DEFAULT false,
        codigo_proveedor text,
        costo_habitual numeric,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT proveedor_productos_empresa_producto_proveedor_uniq UNIQUE (empresa_id, producto_id, proveedor_id)
      )
    $sql$, r.sch, r.sch, r.sch);

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_proveedor_productos_empresa ON %I.proveedor_productos(empresa_id)',
      r.sch
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_proveedor_productos_producto ON %I.proveedor_productos(producto_id)',
      r.sch
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_proveedor_productos_proveedor ON %I.proveedor_productos(proveedor_id)',
      r.sch
    );

    BEGIN
      EXECUTE format(
        'CREATE UNIQUE INDEX IF NOT EXISTS proveedor_productos_un_principal
         ON %I.proveedor_productos (empresa_id, producto_id)
         WHERE es_principal',
        r.sch
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'proveedor_productos partial unique %: %', r.sch, SQLERRM;
    END;

    EXECUTE format(
      'ALTER TABLE %I.proveedor_productos ENABLE ROW LEVEL SECURITY',
      r.sch
    );
    EXECUTE format(
      'CREATE POLICY proveedor_productos_select ON %I.proveedor_productos FOR SELECT
       USING (public.puede_acceder_empresa(empresa_id))',
      r.sch
    );
    EXECUTE format(
      'CREATE POLICY proveedor_productos_insert ON %I.proveedor_productos FOR INSERT
       WITH CHECK (public.puede_acceder_empresa(empresa_id))',
      r.sch
    );
    EXECUTE format(
      'CREATE POLICY proveedor_productos_update ON %I.proveedor_productos FOR UPDATE
       USING (public.puede_acceder_empresa(empresa_id))
       WITH CHECK (public.puede_acceder_empresa(empresa_id))',
      r.sch
    );
    EXECUTE format(
      'CREATE POLICY proveedor_productos_delete ON %I.proveedor_productos FOR DELETE
       USING (public.puede_acceder_empresa(empresa_id))',
      r.sch
    );

    BEGIN
      EXECUTE format(
        $tr$
        DROP TRIGGER IF EXISTS proveedor_productos_updated_at ON %I.proveedor_productos;
        CREATE TRIGGER proveedor_productos_updated_at
          BEFORE UPDATE ON %I.proveedor_productos
          FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
        $tr$,
        r.sch,
        r.sch
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'proveedor_productos trigger %: %', r.sch, SQLERRM;
    END;
  END LOOP;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3) Categorías y relación N:N
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'proveedores'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = r.sch AND table_name = 'proveedor_categorias'
    ) THEN
      EXECUTE format($sql$
        CREATE TABLE %I.proveedor_categorias (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
          nombre text NOT NULL,
          descripcion text,
          activo boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      $sql$, r.sch);

      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_proveedor_categorias_empresa ON %I.proveedor_categorias(empresa_id)',
        r.sch
      );
      BEGIN
        EXECUTE format(
          'CREATE UNIQUE INDEX IF NOT EXISTS proveedor_categorias_empresa_nombre_lower
           ON %I.proveedor_categorias (empresa_id, lower(trim(nombre)))',
          r.sch
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'unique nombre categoría %: %', r.sch, SQLERRM;
      END;

      EXECUTE format(
        'ALTER TABLE %I.proveedor_categorias ENABLE ROW LEVEL SECURITY',
        r.sch
      );
      EXECUTE format(
        'CREATE POLICY proveedor_categorias_select ON %I.proveedor_categorias FOR SELECT
         USING (public.puede_acceder_empresa(empresa_id))',
        r.sch
      );
      EXECUTE format(
        'CREATE POLICY proveedor_categorias_insert ON %I.proveedor_categorias FOR INSERT
         WITH CHECK (public.puede_acceder_empresa(empresa_id))',
        r.sch
      );
      EXECUTE format(
        'CREATE POLICY proveedor_categorias_update ON %I.proveedor_categorias FOR UPDATE
         USING (public.puede_acceder_empresa(empresa_id))
         WITH CHECK (public.puede_acceder_empresa(empresa_id))',
        r.sch
      );
      EXECUTE format(
        'CREATE POLICY proveedor_categorias_delete ON %I.proveedor_categorias FOR DELETE
         USING (public.puede_acceder_empresa(empresa_id))',
        r.sch
      );

      BEGIN
        EXECUTE format(
          $tr$
          DROP TRIGGER IF EXISTS proveedor_categorias_updated_at ON %I.proveedor_categorias;
          CREATE TRIGGER proveedor_categorias_updated_at
            BEFORE UPDATE ON %I.proveedor_categorias
            FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
          $tr$,
          r.sch,
          r.sch
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'proveedor_categorias trigger %: %', r.sch, SQLERRM;
      END;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = r.sch AND table_name = 'proveedor_categoria_rel'
    ) THEN
      EXECUTE format($sql$
        CREATE TABLE %I.proveedor_categoria_rel (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
          proveedor_id uuid NOT NULL REFERENCES %I.proveedores(id) ON DELETE CASCADE,
          categoria_id uuid NOT NULL REFERENCES %I.proveedor_categorias(id) ON DELETE CASCADE,
          created_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT proveedor_categoria_rel_uniq UNIQUE (proveedor_id, categoria_id)
        )
      $sql$, r.sch, r.sch, r.sch);

      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_prov_cat_rel_empresa ON %I.proveedor_categoria_rel(empresa_id)',
        r.sch
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_prov_cat_rel_proveedor ON %I.proveedor_categoria_rel(proveedor_id)',
        r.sch
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_prov_cat_rel_categoria ON %I.proveedor_categoria_rel(categoria_id)',
        r.sch
      );

      EXECUTE format(
        'ALTER TABLE %I.proveedor_categoria_rel ENABLE ROW LEVEL SECURITY',
        r.sch
      );
      EXECUTE format(
        'CREATE POLICY proveedor_categoria_rel_select ON %I.proveedor_categoria_rel FOR SELECT
         USING (public.puede_acceder_empresa(empresa_id))',
        r.sch
      );
      EXECUTE format(
        'CREATE POLICY proveedor_categoria_rel_insert ON %I.proveedor_categoria_rel FOR INSERT
         WITH CHECK (public.puede_acceder_empresa(empresa_id))',
        r.sch
      );
      EXECUTE format(
        'CREATE POLICY proveedor_categoria_rel_update ON %I.proveedor_categoria_rel FOR UPDATE
         USING (public.puede_acceder_empresa(empresa_id))
         WITH CHECK (public.puede_acceder_empresa(empresa_id))',
        r.sch
      );
      EXECUTE format(
        'CREATE POLICY proveedor_categoria_rel_delete ON %I.proveedor_categoria_rel FOR DELETE
         USING (public.puede_acceder_empresa(empresa_id))',
        r.sch
      );
    END IF;
  END LOOP;
END;
$$;
