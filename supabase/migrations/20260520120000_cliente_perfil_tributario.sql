-- Perfil tributario opcional por cliente + catálogo obligaciones + bandera empresa.
-- Zentra catálogo empresas + todos los esquemas con tabla clientes.

-- -----------------------------------------------------------------------------
-- 1) Bandera en catálogo empresas (zentra_erp único)
-- -----------------------------------------------------------------------------
ALTER TABLE zentra_erp.empresas
  ADD COLUMN IF NOT EXISTS gestion_tributaria_clientes boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN zentra_erp.empresas.gestion_tributaria_clientes IS
  'Si true, la empresa puede usar el bloque opcional de perfil tributario en clientes.';

-- -----------------------------------------------------------------------------
-- 2) Tablas por esquema que tenga clientes (plantilla + tenants + legacy public)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
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
    -- Catálogo global en el schema (sin empresa_id; solo lectura)
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = r.sch AND table_name = 'obligaciones_tributarias_catalogo'
    ) THEN
      EXECUTE format($sql$
        CREATE TABLE %I.obligaciones_tributarias_catalogo (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          slug text NOT NULL UNIQUE,
          nombre text NOT NULL,
          requiere_detalle_otro boolean NOT NULL DEFAULT false,
          orden smallint NOT NULL DEFAULT 0
        )
      $sql$, r.sch);

      EXECUTE format(
        'ALTER TABLE %I.obligaciones_tributarias_catalogo ENABLE ROW LEVEL SECURITY',
        r.sch
      );
      EXECUTE format(
        $pol$
        DROP POLICY IF EXISTS obligaciones_tributarias_catalogo_select ON %I.obligaciones_tributarias_catalogo;
        CREATE POLICY obligaciones_tributarias_catalogo_select ON %I.obligaciones_tributarias_catalogo
          FOR SELECT TO authenticated USING (true)
        $pol$,
        r.sch,
        r.sch
      );
      EXECUTE format(
        $pol$
        DROP POLICY IF EXISTS obligaciones_tributarias_catalogo_select_sr ON %I.obligaciones_tributarias_catalogo;
        CREATE POLICY obligaciones_tributarias_catalogo_select_sr ON %I.obligaciones_tributarias_catalogo
          FOR SELECT TO service_role USING (true)
        $pol$,
        r.sch,
        r.sch
      );

      EXECUTE format($ins$
        INSERT INTO %I.obligaciones_tributarias_catalogo (slug, nombre, requiere_detalle_otro, orden) VALUES
          ('iva_general', 'IVA General', false, 10),
          ('ire_simple', 'IRE Simple', false, 20),
          ('ire_general', 'IRE General', false, 30),
          ('resimple', 'RESIMPLE', false, 40),
          ('ips', 'IPS', false, 50),
          ('sin_obligacion', 'Sin obligación', false, 60),
          ('otro', 'Otro', true, 70)
        ON CONFLICT (slug) DO NOTHING
      $ins$, r.sch);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = r.sch AND table_name = 'cliente_perfil_tributario'
    ) THEN
      EXECUTE format($sql$
        CREATE TABLE %I.cliente_perfil_tributario (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
          cliente_id uuid NOT NULL REFERENCES %I.clientes(id) ON DELETE CASCADE,
          perfil_activo boolean NOT NULL DEFAULT false,
          dv text,
          razon_social_fiscal text,
          clave_tributaria_encrypted text,
          fecha_vencimiento date,
          honorario_mensual numeric,
          honorario_anual numeric,
          notas_tributarias text,
          obligacion_otro_detalle text,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT cliente_perfil_tributario_empresa_cliente_unique UNIQUE (empresa_id, cliente_id)
        )
      $sql$, r.sch, r.sch);

      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_cliente_perfil_tributario_empresa ON %I.cliente_perfil_tributario(empresa_id)',
        r.sch
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_cliente_perfil_tributario_cliente ON %I.cliente_perfil_tributario(cliente_id)',
        r.sch
      );

      EXECUTE format(
        'ALTER TABLE %I.cliente_perfil_tributario ENABLE ROW LEVEL SECURITY',
        r.sch
      );
      EXECUTE format(
        $pol$
        CREATE POLICY cliente_perfil_tributario_select ON %I.cliente_perfil_tributario FOR SELECT
          USING (public.puede_acceder_empresa(empresa_id))
        $pol$,
        r.sch
      );
      EXECUTE format(
        $pol$
        CREATE POLICY cliente_perfil_tributario_insert ON %I.cliente_perfil_tributario FOR INSERT
          WITH CHECK (public.puede_acceder_empresa(empresa_id))
        $pol$,
        r.sch
      );
      EXECUTE format(
        $pol$
        CREATE POLICY cliente_perfil_tributario_update ON %I.cliente_perfil_tributario FOR UPDATE
          USING (public.puede_acceder_empresa(empresa_id))
          WITH CHECK (public.puede_acceder_empresa(empresa_id))
        $pol$,
        r.sch
      );
      EXECUTE format(
        $pol$
        CREATE POLICY cliente_perfil_tributario_delete ON %I.cliente_perfil_tributario FOR DELETE
          USING (public.puede_acceder_empresa(empresa_id))
        $pol$,
        r.sch
      );

      BEGIN
        EXECUTE format(
          $tr$
          DROP TRIGGER IF EXISTS cliente_perfil_tributario_updated_at ON %I.cliente_perfil_tributario;
          CREATE TRIGGER cliente_perfil_tributario_updated_at
            BEFORE UPDATE ON %I.cliente_perfil_tributario
            FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
          $tr$,
          r.sch,
          r.sch
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'cliente_perfil_tributario trigger %: %', r.sch, SQLERRM;
      END;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = r.sch AND table_name = 'cliente_obligaciones_tributarias'
    ) THEN
      EXECUTE format($sql$
        CREATE TABLE %I.cliente_obligaciones_tributarias (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
          cliente_perfil_id uuid NOT NULL REFERENCES %I.cliente_perfil_tributario(id) ON DELETE CASCADE,
          obligacion_catalogo_id uuid NOT NULL REFERENCES %I.obligaciones_tributarias_catalogo(id) ON DELETE CASCADE,
          created_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT cliente_obligaciones_tributarias_uniq UNIQUE (cliente_perfil_id, obligacion_catalogo_id)
        )
      $sql$, r.sch, r.sch, r.sch);

      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_cliente_obligaciones_empresa ON %I.cliente_obligaciones_tributarias(empresa_id)',
        r.sch
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_cliente_obligaciones_perfil ON %I.cliente_obligaciones_tributarias(cliente_perfil_id)',
        r.sch
      );

      EXECUTE format(
        'ALTER TABLE %I.cliente_obligaciones_tributarias ENABLE ROW LEVEL SECURITY',
        r.sch
      );
      EXECUTE format(
        $pol$
        CREATE POLICY cliente_obligaciones_tributarias_select ON %I.cliente_obligaciones_tributarias FOR SELECT
          USING (public.puede_acceder_empresa(empresa_id))
        $pol$,
        r.sch
      );
      EXECUTE format(
        $pol$
        CREATE POLICY cliente_obligaciones_tributarias_insert ON %I.cliente_obligaciones_tributarias FOR INSERT
          WITH CHECK (public.puede_acceder_empresa(empresa_id))
        $pol$,
        r.sch
      );
      EXECUTE format(
        $pol$
        CREATE POLICY cliente_obligaciones_tributarias_update ON %I.cliente_obligaciones_tributarias FOR UPDATE
          USING (public.puede_acceder_empresa(empresa_id))
          WITH CHECK (public.puede_acceder_empresa(empresa_id))
        $pol$,
        r.sch
      );
      EXECUTE format(
        $pol$
        CREATE POLICY cliente_obligaciones_tributarias_delete ON %I.cliente_obligaciones_tributarias FOR DELETE
          USING (public.puede_acceder_empresa(empresa_id))
        $pol$,
        r.sch
      );
    END IF;
  END LOOP;
END;
$$;
