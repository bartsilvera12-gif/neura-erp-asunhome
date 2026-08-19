-- =============================================================================
-- ASUNHOME — Copiar la CONFIGURACIÓN de Ferrecolor (no los datos del negocio)
--
-- Resuelve el sidebar con módulos de más y el "sin vistas asignadas": el menú
-- y el dashboard se arman desde la base, y esas tablas quedaron vacías tras el
-- clon estructural.
--
-- Copia: modulos, dashboard_views (catálogos globales)
--        empresa_modulos, empresa_dashboard_views (remapeando empresa_id)
--        + catálogos operativos opcionales (bloque 2)
--
-- NO copia: productos, clientes, ventas, compras ni nada del negocio.
--
-- Idempotente: ON CONFLICT DO NOTHING. Se puede re-ejecutar.
-- =============================================================================

DO $cfg$
DECLARE
  v_src      text := 'ferrecolor';
  v_tgt      text := 'asunhome';
  v_empresa  uuid := 'a5817a20-9fef-47c4-b44a-62aa5783d473';   -- ASUNHOME
  v_tabla    text;
  v_cols     text;
  v_select   text;
  v_n        bigint;
  v_total    bigint := 0;

  -- Catálogos globales: se copian tal cual (no tienen empresa_id)
  v_globales text[] := ARRAY['modulos','dashboard_views'];

  -- Configuración por empresa: se copia remapeando empresa_id
  v_empresa_scoped text[] := ARRAY['empresa_modulos','empresa_dashboard_views'];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM asunhome.empresas WHERE id = v_empresa) THEN
    RAISE EXCEPTION 'La empresa % no existe en %. Corregí el UUID arriba.', v_empresa, v_tgt;
  END IF;

  -- ── 1) Catálogos globales ──────────────────────────────────────────────────
  FOREACH v_tabla IN ARRAY v_globales
  LOOP
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = v_tgt AND c.relname = v_tabla AND c.relkind = 'r');

    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_cols
    FROM information_schema.columns
    WHERE table_schema = v_tgt AND table_name = v_tabla
      AND column_name IN (SELECT column_name FROM information_schema.columns
                          WHERE table_schema = v_src AND table_name = v_tabla);

    EXECUTE format(
      'INSERT INTO %I.%I (%s) SELECT %s FROM %I.%I ON CONFLICT DO NOTHING',
      v_tgt, v_tabla, v_cols, v_cols, v_src, v_tabla
    );
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_total := v_total + v_n;
    RAISE NOTICE 'catalogo %: % filas', v_tabla, v_n;
  END LOOP;

  -- ── 2) Configuración por empresa (empresa_id reemplazado) ─────────────────
  FOREACH v_tabla IN ARRAY v_empresa_scoped
  LOOP
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = v_tgt AND c.relname = v_tabla AND c.relkind = 'r');

    -- columnas comunes a ambos schemas
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position),
           string_agg(CASE WHEN column_name = 'empresa_id'
                           THEN quote_literal(v_empresa) || '::uuid'
                           ELSE quote_ident(column_name) END, ', ' ORDER BY ordinal_position)
    INTO v_cols, v_select
    FROM information_schema.columns
    WHERE table_schema = v_tgt AND table_name = v_tabla
      AND column_name IN (SELECT column_name FROM information_schema.columns
                          WHERE table_schema = v_src AND table_name = v_tabla);

    EXECUTE format(
      'INSERT INTO %I.%I (%s) SELECT %s FROM %I.%I ON CONFLICT DO NOTHING',
      v_tgt, v_tabla, v_cols, v_select, v_src, v_tabla
    );
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_total := v_total + v_n;
    RAISE NOTICE 'config %: % filas', v_tabla, v_n;
  END LOOP;

  RAISE NOTICE 'TOTAL configuracion copiada: % filas', v_total;
END;
$cfg$;


-- =============================================================================
-- BLOQUE 2 (opcional) — Catálogos operativos
-- Etapas de CRM, tipos de servicio de cliente, estados de proyecto, bancos, etc.
-- Son listas desplegables, no datos del negocio. Descomentá si los querés.
-- =============================================================================
-- DO $cat$
-- DECLARE
--   v_src text := 'ferrecolor';
--   v_tgt text := 'asunhome';
--   v_empresa uuid := 'a5817a20-9fef-47c4-b44a-62aa5783d473';
--   v_tabla text;
--   v_cols text; v_select text; v_n bigint;
--   v_lista text[] := ARRAY[
--     'crm_etapas','cliente_tipos_servicio_catalogo','obligaciones_tributarias_catalogo',
--     'entidades_bancarias','tipificaciones','proyecto_estados','proyecto_tipos',
--     'proyecto_prioridades_config'
--   ];
-- BEGIN
--   FOREACH v_tabla IN ARRAY v_lista
--   LOOP
--     CONTINUE WHEN NOT EXISTS (
--       SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--       WHERE n.nspname = v_tgt AND c.relname = v_tabla AND c.relkind = 'r');
--     SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position),
--            string_agg(CASE WHEN column_name = 'empresa_id'
--                            THEN quote_literal(v_empresa) || '::uuid'
--                            ELSE quote_ident(column_name) END, ', ' ORDER BY ordinal_position)
--     INTO v_cols, v_select
--     FROM information_schema.columns
--     WHERE table_schema = v_tgt AND table_name = v_tabla
--       AND column_name IN (SELECT column_name FROM information_schema.columns
--                           WHERE table_schema = v_src AND table_name = v_tabla);
--     BEGIN
--       EXECUTE format('INSERT INTO %I.%I (%s) SELECT %s FROM %I.%I ON CONFLICT DO NOTHING',
--                      v_tgt, v_tabla, v_cols, v_select, v_src, v_tabla);
--       GET DIAGNOSTICS v_n = ROW_COUNT;
--       RAISE NOTICE 'catalogo %: % filas', v_tabla, v_n;
--     EXCEPTION WHEN OTHERS THEN
--       RAISE WARNING 'catalogo % omitido: %', v_tabla, SQLERRM;
--     END;
--   END LOOP;
-- END;
-- $cat$;


-- =============================================================================
-- VERIFICACIÓN — comparar la configuración de ambos schemas
-- =============================================================================
SELECT 'modulos' AS tabla,
       (SELECT count(*) FROM ferrecolor.modulos) AS ferrecolor,
       (SELECT count(*) FROM asunhome.modulos)   AS asunhome
UNION ALL SELECT 'empresa_modulos',
       (SELECT count(*) FROM ferrecolor.empresa_modulos),
       (SELECT count(*) FROM asunhome.empresa_modulos)
UNION ALL SELECT 'dashboard_views',
       (SELECT count(*) FROM ferrecolor.dashboard_views),
       (SELECT count(*) FROM asunhome.dashboard_views)
UNION ALL SELECT 'empresa_dashboard_views',
       (SELECT count(*) FROM ferrecolor.empresa_dashboard_views),
       (SELECT count(*) FROM asunhome.empresa_dashboard_views);

-- Módulos que quedaron habilitados para ASUNHOME
SELECT m.slug, m.nombre, em.activo
FROM asunhome.empresa_modulos em
JOIN asunhome.modulos m ON m.id = em.modulo_id
WHERE em.empresa_id = 'a5817a20-9fef-47c4-b44a-62aa5783d473'
ORDER BY em.activo DESC, m.slug;
