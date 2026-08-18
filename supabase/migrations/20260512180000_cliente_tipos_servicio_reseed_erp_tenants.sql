-- Reseed + reconectar trigger del catálogo de tipos de servicio en todos los schemas con tabla `clientes`.
--
-- Contexto:
--   La migración 20260524120000_cliente_tipos_servicio_catalogo.sql creó la tabla
--   `<schema>.cliente_tipos_servicio_catalogo`, los seeds sistema (marketing, saas, branding, web, otro)
--   y el trigger `trg_clientes_tipo_servicio_catalogo` sobre `<schema>.clientes`.
--
--   Sin embargo, empresas provisionadas *después* de esa migración (p. ej. Catalia → erp_catalia_e_a_s_8b405538)
--   recibieron la tabla por clonado pero quedaron sin seeds y/o sin el trigger.
--
--   Esta migración es totalmente idempotente y no destructiva:
--     1. Garantiza los 5 slugs sistema (marketing, saas, branding, web, otro) para cada empresa cuyo
--        `data_schema` coincide con el schema iterado (o public/zentra_erp para empresas legacy).
--     2. Garantiza la presencia del trigger `trg_clientes_tipo_servicio_catalogo` en `<schema>.clientes`.
--     3. Garantiza que `set_updated_at` esté conectado a la tabla del catálogo.
--
--   Idempotente porque usa `ON CONFLICT (empresa_id, slug) DO NOTHING` y `DROP TRIGGER IF EXISTS`
--   antes de recrear, y porque no toca filas existentes ni renombra slugs.
--
--   Mantiene compatibilidad con zentra_erp (slugs ya estaban; ON CONFLICT no inserta duplicados).
--   No depende del nombre del schema: aplica a todo schema con tabla `cliente_tipos_servicio_catalogo`.

-- 1) Seeds: siempre re-aseguramos los 5 slugs sistema para cada empresa del schema iterado.
DO $$
DECLARE
  r   RECORD;
  sch text;
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
    BEGIN
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
          sch,
          sch
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'reseed slugs sistema %: %', sch, SQLERRM;
    END;
  END LOOP;
END;
$$;

-- 2) Trigger: re-crear en cada schema con tabla `clientes`.
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
      RAISE NOTICE 'recreate trg_clientes_tipo_servicio_catalogo %: %', r.sch, SQLERRM;
    END;
  END LOOP;
END;
$$;

-- 3) set_updated_at: reconectar trigger de updated_at sobre el catálogo (idempotente).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
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
    BEGIN
      EXECUTE format(
        'DROP TRIGGER IF EXISTS cliente_tipos_servicio_catalogo_updated_at ON %I.cliente_tipos_servicio_catalogo',
        r.sch
      );
      EXECUTE format(
        $tr$
        CREATE TRIGGER cliente_tipos_servicio_catalogo_updated_at
          BEFORE UPDATE ON %I.cliente_tipos_servicio_catalogo
          FOR EACH ROW
          EXECUTE FUNCTION public.set_updated_at()
        $tr$,
        r.sch
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'reconnect updated_at trigger %: %', r.sch, SQLERRM;
    END;
  END LOOP;
END;
$$;
