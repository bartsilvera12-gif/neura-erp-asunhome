-- Catálogo de tipos de servicio / segmento de cliente por empresa (configurable, slugs estables).
-- En todo schema con tabla `clientes` (public, zentra_erp, er_*, erp_*).

CREATE OR REPLACE FUNCTION public.trg_clientes_tipo_servicio_requiere_catalogo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  sch   text := TG_TABLE_SCHEMA;
  tslug text;
  ok    boolean;
BEGIN
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND NEW.empresa_id IS NOT NULL THEN
    tslug := NEW.tipo_servicio_cliente;
    IF tslug IS NULL OR btrim(tslug) = '' THEN
      NEW.tipo_servicio_cliente := NULL;
    ELSE
      NEW.tipo_servicio_cliente := lower(btrim(tslug));
      tslug := NEW.tipo_servicio_cliente;
      EXECUTE format(
        $f$
        SELECT EXISTS(
          SELECT 1
          FROM %I.cliente_tipos_servicio_catalogo t
          WHERE t.empresa_id = $1
            AND t.slug = $2
        )
        $f$,
        sch
      ) INTO ok USING NEW.empresa_id, tslug;
      IF NOT coalesce(ok, false) THEN
        RAISE EXCEPTION 'tipo_servicio_cliente inexistente en el catálogo: % (empresa %, schema %)', tslug, NEW.empresa_id, sch
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 1) Tabla, RLS y seed por schema; quitar CHECK rígido
DO $$
DECLARE
  r  RECORD;
  nm text;
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
    IF to_regclass(format('%I.cliente_tipos_servicio_catalogo', r.sch)) IS NULL THEN
      EXECUTE format(
        $sql$
        CREATE TABLE %I.cliente_tipos_servicio_catalogo (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
          slug text NOT NULL,
          nombre text NOT NULL,
          activo boolean NOT NULL DEFAULT true,
          orden smallint NOT NULL DEFAULT 0,
          es_sistema boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT c_cliente_tipo_cat_slug_format CHECK (
            char_length(btrim(slug)) > 0
            AND slug = lower(btrim(slug))
            AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
          )
        )
        $sql$,
        r.sch
      );
      EXECUTE format(
        'ALTER TABLE %I.cliente_tipos_servicio_catalogo ADD CONSTRAINT uq_cxtcat_empresa_slug UNIQUE (empresa_id, slug)',
        r.sch
      );
      nm := 'ixctsc_' || replace(md5(r.sch::text), ' ', '');
      IF char_length(nm) < 2 THEN
        nm := 'ixctsc_sch';
      END IF;
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.cliente_tipos_servicio_catalogo (empresa_id, activo, orden)', nm, r.sch);
      EXECUTE format('ALTER TABLE %I.cliente_tipos_servicio_catalogo ENABLE ROW LEVEL SECURITY', r.sch);
      EXECUTE format(
        $pol$
        DROP POLICY IF EXISTS cliente_tipos_servicio_catalogo_select ON %I.cliente_tipos_servicio_catalogo;
        CREATE POLICY cliente_tipos_servicio_catalogo_select ON %I.cliente_tipos_servicio_catalogo
          FOR SELECT
          USING (public.puede_acceder_empresa(empresa_id))
        $pol$,
        r.sch,
        r.sch
      );
      EXECUTE format(
        $pol$
        DROP POLICY IF EXISTS cliente_tipos_servicio_catalogo_insert ON %I.cliente_tipos_servicio_catalogo;
        CREATE POLICY cliente_tipos_servicio_catalogo_insert ON %I.cliente_tipos_servicio_catalogo
          FOR INSERT
          WITH CHECK (public.puede_acceder_empresa(empresa_id))
        $pol$,
        r.sch,
        r.sch
      );
      EXECUTE format(
        $pol$
        DROP POLICY IF EXISTS cliente_tipos_servicio_catalogo_update ON %I.cliente_tipos_servicio_catalogo;
        CREATE POLICY cliente_tipos_servicio_catalogo_update ON %I.cliente_tipos_servicio_catalogo
          FOR UPDATE
          USING (public.puede_acceder_empresa(empresa_id))
          WITH CHECK (public.puede_acceder_empresa(empresa_id))
        $pol$,
        r.sch,
        r.sch
      );
      EXECUTE format(
        $pol$
        DROP POLICY IF EXISTS cliente_tipos_servicio_catalogo_delete ON %I.cliente_tipos_servicio_catalogo;
        CREATE POLICY cliente_tipos_servicio_catalogo_delete ON %I.cliente_tipos_servicio_catalogo
          FOR DELETE
          USING (public.puede_acceder_empresa(empresa_id))
        $pol$,
        r.sch,
        r.sch
      );
      BEGIN
        EXECUTE format(
          $tr$
          DROP TRIGGER IF EXISTS cliente_tipos_servicio_catalogo_updated_at ON %I.cliente_tipos_servicio_catalogo;
          CREATE TRIGGER cliente_tipos_servicio_catalogo_updated_at
            BEFORE UPDATE ON %I.cliente_tipos_servicio_catalogo
            FOR EACH ROW
            EXECUTE FUNCTION public.set_updated_at()
          $tr$,
          r.sch,
          r.sch
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'set_updated_at catálogo %: %', r.sch, SQLERRM;
      END;
      BEGIN
        EXECUTE format(
          'COMMENT ON TABLE %I.cliente_tipos_servicio_catalogo IS %L',
          r.sch,
          'Tipos/segmento de servicio de clientes. Slug estable; el nombre se puede editar.'
        );
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;

    BEGIN
      EXECUTE format('ALTER TABLE %I.clientes DROP CONSTRAINT IF EXISTS clientes_tipo_servicio_cliente_check', r.sch);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'drop check tipo_servicio %: %', r.sch, SQLERRM;
    END;
  END LOOP;
END;
$$;

-- 2) Seed: siempre hacia el schema concreto (re-ejecución segura)
DO $$
DECLARE
  r   RECORD;
  sch text;
  pks text;
BEGIN
  FOR r IN
    SELECT n.nspname AS s
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'cliente_tipos_servicio_catalogo'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
  LOOP
    sch := r.s;
    IF sch = 'public' OR sch = 'zentra_erp' THEN
      EXECUTE format(
        $ins$
        INSERT INTO %I.cliente_tipos_servicio_catalogo (empresa_id, slug, nombre, activo, es_sistema, orden)
        SELECT
          e.id,
          v.slug,
          v.nombre,
          true,
          true,
          v.orden
        FROM zentra_erp.empresas e
        CROSS JOIN (VALUES
          ('marketing',  'Marketing',  10::smallint),
          ('saas',       'SaaS',         20::smallint),
          ('branding',   'Branding',     30::smallint),
          ('web',        'Web',          40::smallint),
          ('otro',       'Otro',         50::smallint)
        ) AS v(slug, nombre, orden)
        WHERE (
          e.data_schema IS NULL
          OR btrim(e.data_schema) = ''
          OR lower(btrim(e.data_schema)) = 'zentra_erp'
        )
        ON CONFLICT (empresa_id, slug) DO NOTHING
        $ins$,
        sch
      );
    ELSE
      pks := sch;
      EXECUTE format(
        $ins$
        INSERT INTO %I.cliente_tipos_servicio_catalogo (empresa_id, slug, nombre, activo, es_sistema, orden)
        SELECT
          e.id,
          v.slug,
          v.nombre,
          true,
          true,
          v.orden
        FROM zentra_erp.empresas e
        CROSS JOIN (VALUES
          ('marketing',  'Marketing',  10::smallint),
          ('saas',       'SaaS',         20::smallint),
          ('branding',   'Branding',     30::smallint),
          ('web',        'Web',          40::smallint),
          ('otro',       'Otro',         50::smallint)
        ) AS v(slug, nombre, orden)
        WHERE btrim(e.data_schema) = %L
        ON CONFLICT (empresa_id, slug) DO NOTHING
        $ins$,
        pks,
        pks
      );
    END IF;
  END LOOP;
END;
$$;

-- 3) Normalizar clientes, añadir slugs faltantes al catálogo, conectar trigger
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
    BEGIN
    EXECUTE format(
      $n$
      UPDATE %I.clientes
      SET tipo_servicio_cliente = lower(btrim(tipo_servicio_cliente))
      WHERE tipo_servicio_cliente IS NOT NULL
        AND btrim(tipo_servicio_cliente) <> ''
        AND tipo_servicio_cliente <> lower(btrim(tipo_servicio_cliente))
      $n$,
      r.sch
    );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'normalize clientes.tipo %: %', r.sch, SQLERRM;
    END;

    BEGIN
    EXECUTE format(
      $nv$
      UPDATE %I.clientes
      SET tipo_servicio_cliente = NULL
      WHERE tipo_servicio_cliente IS NOT NULL
        AND btrim(tipo_servicio_cliente) <> ''
        AND tipo_servicio_cliente !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      $nv$,
      r.sch
    );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'null invalid tipo %: %', r.sch, SQLERRM;
    END;

    BEGIN
    EXECUTE format(
      $bf$
      INSERT INTO %I.cliente_tipos_servicio_catalogo (empresa_id, slug, nombre, activo, es_sistema, orden)
      SELECT DISTINCT
        c.empresa_id,
        c.tipo_servicio_cliente,
        initcap(replace(c.tipo_servicio_cliente, '-', ' ')),
        true,
        false,
        1000
      FROM %I.clientes c
      WHERE c.tipo_servicio_cliente IS NOT NULL
        AND btrim(c.tipo_servicio_cliente) <> ''
        AND NOT EXISTS (
          SELECT 1
          FROM %I.cliente_tipos_servicio_catalogo t
          WHERE t.empresa_id = c.empresa_id
            AND t.slug = c.tipo_servicio_cliente
        )
      ON CONFLICT (empresa_id, slug) DO NOTHING
      $bf$,
      r.sch,
      r.sch,
      r.sch
    );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'backfill catálogo %: %', r.sch, SQLERRM;
    END;

    BEGIN
    EXECUTE format('DROP TRIGGER IF EXISTS trg_clientes_tipo_servicio_catalogo ON %I.clientes', r.sch);
    EXECUTE format(
      $t$
      CREATE TRIGGER trg_clientes_tipo_servicio_catalogo
        BEFORE INSERT OR UPDATE OF tipo_servicio_cliente
        ON %I.clientes
        FOR EACH ROW
        EXECUTE FUNCTION public.trg_clientes_tipo_servicio_requiere_catalogo()
      $t$,
      r.sch
    );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'trigger clientes.tipo %: %', r.sch, SQLERRM;
    END;
  END LOOP;
END;
$$;
