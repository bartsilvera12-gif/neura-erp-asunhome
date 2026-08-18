-- =============================================================================
-- ASUNHOME ERP — Setup completo del schema `asunhome`
-- Destino: Supabase self-hosted → SQL Editor (ejecutar como `postgres`)
--
-- Qué hace, en orden:
--   PARTE 0  Preflight: extensiones + validación del schema origen
--   PARTE 1  Helpers de clonación (funciones en `public`)
--   PARTE 2  CREATE SCHEMA asunhome + clonación ESTRUCTURAL de `ferrecolor`
--            (tablas, PK/UNIQUE/CHECK, índices, FKs, funciones, triggers,
--             vistas, matviews, RLS + policies)  ← SIN COPIAR DATOS
--   PARTE 3  Tablas/columnas nuevas del alcance ASUNHOME
--   PARTE 4  Vistas de reportes
--   PARTE 5  GRANTS + default privileges + realtime + reload PostgREST
--   PARTE 6  Verificación
--
-- Idempotencia: PARTE 2 aborta si `asunhome` ya existe (para no pisar datos).
--               PARTES 3-6 son IF NOT EXISTS y se pueden re-ejecutar solas.
--
-- Se puede correr entero de una sola vez.
-- =============================================================================


-- =============================================================================
-- PARTE 0 — PREFLIGHT
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Confirmá acá el nombre real del schema origen antes de ejecutar.
-- Si no sabés cuál es, corré primero esta consulta sola:
--
--   SELECT nspname
--   FROM pg_namespace
--   WHERE nspname NOT IN ('pg_catalog','information_schema','pg_toast')
--     AND nspname NOT LIKE 'pg_%'
--   ORDER BY 1;
--
DO $preflight$
DECLARE
  v_src text := 'ferrecolor';   -- ← SCHEMA ORIGEN
  v_tgt text := 'asunhome';     -- ← SCHEMA DESTINO
  v_tipos text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = v_src) THEN
    RAISE EXCEPTION
      'El schema origen "%" no existe. Schemas disponibles: %',
      v_src,
      (SELECT string_agg(nspname, ', ' ORDER BY nspname)
       FROM pg_namespace
       WHERE nspname NOT IN ('pg_catalog','information_schema','pg_toast')
         AND nspname NOT LIKE 'pg\_%');
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = v_tgt) THEN
    RAISE EXCEPTION
      'El schema destino "%" YA existe. Si querés rehacerlo desde cero: DROP SCHEMA %I CASCADE;',
      v_tgt, v_tgt;
  END IF;

  -- Tipos/dominios propios no se clonan automáticamente: avisar si los hubiera.
  SELECT string_agg(t.typname, ', ')
  INTO v_tipos
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = v_src
    AND t.typtype IN ('e','d')       -- enum / domain
  ;
  IF v_tipos IS NOT NULL THEN
    RAISE WARNING
      'El origen define tipos propios (%). Las columnas clonadas seguirán apuntando a %.<tipo>. Revisalo al final.',
      v_tipos, v_src;
  END IF;

  RAISE NOTICE 'Preflight OK: % → %', v_src, v_tgt;
END;
$preflight$;


-- =============================================================================
-- PARTE 1 — HELPERS DE CLONACIÓN
-- =============================================================================

-- Reescribe referencias al schema origen (y al legacy zentra_erp, cuando el
-- objeto también existe en el origen) apuntándolas al schema destino.
CREATE OR REPLACE FUNCTION public.neura_rewrite_schema_refs(
  p_expr    text,
  p_src     text,
  p_tgt     text,
  p_objetos text[]
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  r text := p_expr;
  o text;
BEGIN
  IF p_expr IS NULL THEN
    RETURN NULL;
  END IF;

  -- 1) zentra_erp.<obj> → destino, solo si <obj> vive también en el origen
  FOREACH o IN ARRAY coalesce(p_objetos, ARRAY[]::text[])
  LOOP
    r := regexp_replace(r, '\mzentra_erp\.' || o || '\M', p_tgt || '.' || o, 'g');
    r := replace(r, 'zentra_erp."' || o || '"', p_tgt || '."' || o || '"');
  END LOOP;

  -- 2) Renombre general del schema origen → destino
  --    (cubre prefijos calificados, search_path y comentarios)
  r := replace(r, '"' || p_src || '"', '"' || p_tgt || '"');
  r := regexp_replace(r, '\m' || p_src || '\M', p_tgt, 'g');

  RETURN r;
END;
$fn$;


-- Clonación estructural completa origen → destino. NO copia filas.
CREATE OR REPLACE FUNCTION public.neura_clonar_schema_estructura(
  p_src text,
  p_tgt text
)
RETURNS void
LANGUAGE plpgsql
AS $clone$
DECLARE
  v_tablas   text[];
  v_objetos  text[];
  v_tgt      text := quote_ident(p_tgt);
  r          RECORD;
  tbl        text;
  def        text;
  fdef       text;
  vdef       text;
  tdef       text;
  qual       text;
  chk        text;
  roles_cl   text;
  fn_oid     oid;
  v_round    int;
  v_fallas   int;
  v_pass     int;
  v_pub      text := 'supabase_realtime';
BEGIN
  IF p_tgt !~ '^[a-z][a-z0-9_]*$' OR length(p_tgt) > 63 THEN
    RAISE EXCEPTION 'schema destino inválido: %', p_tgt;
  END IF;
  IF p_src !~ '^[a-z][a-z0-9_]*$' THEN
    RAISE EXCEPTION 'schema origen inválido: %', p_src;
  END IF;

  -- Tablas ordinarias del origen
  SELECT coalesce(array_agg(c.relname::text ORDER BY c.relname), '{}')
  INTO v_tablas
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = p_src AND c.relkind = 'r';

  IF coalesce(array_length(v_tablas, 1), 0) = 0 THEN
    RAISE EXCEPTION 'el schema origen % no tiene tablas', p_src;
  END IF;

  -- Todos los nombres de objeto del origen (relaciones + rutinas):
  -- se usan para decidir qué referencias a zentra_erp reapuntar.
  SELECT coalesce(array_agg(DISTINCT nom), '{}')
  INTO v_objetos
  FROM (
    SELECT c.relname::text AS nom
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = p_src AND c.relkind IN ('r','v','m','p')
    UNION
    SELECT p.proname::text
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = p_src
  ) s;

  EXECUTE format('CREATE SCHEMA %I', p_tgt);
  EXECUTE format(
    'GRANT USAGE ON SCHEMA %I TO postgres, anon, authenticated, service_role',
    p_tgt
  );

  ---------------------------------------------------------------------------
  -- 1) Tablas vacías (estructura, defaults, identity, comentarios)
  ---------------------------------------------------------------------------
  FOREACH tbl IN ARRAY v_tablas
  LOOP
    EXECUTE format(
      'CREATE TABLE %s.%I (LIKE %I.%I '
      || 'INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING IDENTITY '
      || 'INCLUDING STORAGE INCLUDING COMMENTS '
      || 'EXCLUDING CONSTRAINTS EXCLUDING INDEXES)',
      v_tgt, tbl, p_src, tbl
    );
  END LOOP;
  RAISE NOTICE 'clon: % tablas creadas', array_length(v_tablas, 1);

  ---------------------------------------------------------------------------
  -- 2) PK / UNIQUE / CHECK
  ---------------------------------------------------------------------------
  FOR r IN
    SELECT c.oid, c.conname::text AS conname, cf.relname::text AS relname
    FROM pg_constraint c
    JOIN pg_class cf     ON cf.oid = c.conrelid
    JOIN pg_namespace nf ON nf.oid = cf.relnamespace
    WHERE nf.nspname = p_src
      AND c.contype IN ('p','u','c')
      AND cf.relname = ANY (v_tablas)
    ORDER BY CASE c.contype WHEN 'p' THEN 1 WHEN 'u' THEN 2 ELSE 3 END, c.conname
  LOOP
    def := public.neura_rewrite_schema_refs(pg_get_constraintdef(r.oid), p_src, p_tgt, v_objetos);
    BEGIN
      EXECUTE format('ALTER TABLE %s.%I ADD CONSTRAINT %I %s', v_tgt, r.relname, r.conname, def);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'clon: constraint %.% omitido: %', r.relname, r.conname, SQLERRM;
    END;
  END LOOP;

  ---------------------------------------------------------------------------
  -- 3) Índices secundarios (los que no respaldan constraints)
  ---------------------------------------------------------------------------
  FOR r IN
    SELECT pg_get_indexdef(i.oid) AS idef
    FROM pg_class i
    JOIN pg_namespace n  ON n.oid = i.relnamespace
    JOIN pg_index ix     ON ix.indexrelid = i.oid
    JOIN pg_class t      ON t.oid = ix.indrelid
    WHERE n.nspname = p_src
      AND i.relkind = 'i'
      AND ix.indisprimary IS FALSE
      AND NOT EXISTS (SELECT 1 FROM pg_constraint co WHERE co.conindid = i.oid)
      AND t.relname = ANY (v_tablas)
  LOOP
    def := public.neura_rewrite_schema_refs(r.idef, p_src, p_tgt, v_objetos);
    BEGIN
      EXECUTE def;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'clon: índice omitido: % (%)', def, SQLERRM;
    END;
  END LOOP;

  ---------------------------------------------------------------------------
  -- 4) Foreign keys
  ---------------------------------------------------------------------------
  FOR r IN
    SELECT c.oid, c.conname::text AS conname, cf.relname::text AS from_table
    FROM pg_constraint c
    JOIN pg_class cf     ON cf.oid = c.conrelid
    JOIN pg_namespace nf ON nf.oid = cf.relnamespace
    WHERE nf.nspname = p_src
      AND c.contype = 'f'
      AND cf.relname = ANY (v_tablas)
    ORDER BY c.conname
  LOOP
    def := public.neura_rewrite_schema_refs(pg_get_constraintdef(r.oid), p_src, p_tgt, v_objetos);
    BEGIN
      EXECUTE format('ALTER TABLE %s.%I ADD CONSTRAINT %I %s', v_tgt, r.from_table, r.conname, def);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'clon: FK %.% omitida: %', r.from_table, r.conname, SQLERRM;
    END;
  END LOOP;

  ---------------------------------------------------------------------------
  -- 5) Funciones / procedimientos (varias rondas por dependencias mutuas)
  ---------------------------------------------------------------------------
  FOR v_round IN 1..25
  LOOP
    v_fallas := 0;
    FOR fn_oid IN
      SELECT p.oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l  ON l.oid = p.prolang
      WHERE n.nspname = p_src
        AND p.prokind IN ('f','p')
        AND l.lanname IN ('plpgsql','sql')
    LOOP
      BEGIN
        fdef := pg_get_functiondef(fn_oid);
      EXCEPTION WHEN OTHERS THEN
        CONTINUE;
      END;
      IF fdef IS NULL THEN
        CONTINUE;
      END IF;
      fdef := public.neura_rewrite_schema_refs(fdef, p_src, p_tgt, v_objetos);
      BEGIN
        EXECUTE fdef;
      EXCEPTION WHEN OTHERS THEN
        v_fallas := v_fallas + 1;   -- se reintenta en la ronda siguiente
      END;
    END LOOP;
    EXIT WHEN v_fallas = 0;
  END LOOP;
  IF v_fallas > 0 THEN
    RAISE WARNING 'clon: % funcion(es) no pudieron recrearse tras 25 rondas', v_fallas;
  END IF;

  ---------------------------------------------------------------------------
  -- 6) Triggers
  ---------------------------------------------------------------------------
  FOR r IN
    SELECT tg.tgname::text AS tgname,
           c.relname::text AS tablename,
           pg_get_triggerdef(tg.oid, true) AS tdef
    FROM pg_trigger tg
    JOIN pg_class c     ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = p_src
      AND NOT tg.tgisinternal
      AND c.relname = ANY (v_tablas)
  LOOP
    tdef := public.neura_rewrite_schema_refs(r.tdef, p_src, p_tgt, v_objetos);
    BEGIN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON %s.%I', r.tgname, v_tgt, r.tablename);
      EXECUTE tdef;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'clon: trigger % en % omitido: %', r.tgname, r.tablename, SQLERRM;
    END;
  END LOOP;

  ---------------------------------------------------------------------------
  -- 7) Defaults de columna que aún apunten al origen
  ---------------------------------------------------------------------------
  FOR r IN
    SELECT c.relname::text AS tabla,
           a.attname::text AS col,
           pg_get_expr(ad.adbin, ad.adrelid) AS expr
    FROM pg_attrdef ad
    JOIN pg_class c      ON c.oid = ad.adrelid
    JOIN pg_namespace n  ON n.oid = c.relnamespace
    JOIN pg_attribute a  ON a.attrelid = ad.adrelid AND a.attnum = ad.adnum
    WHERE n.nspname = p_tgt
      AND pg_get_expr(ad.adbin, ad.adrelid) ~ ('\m' || p_src || '\M')
  LOOP
    def := public.neura_rewrite_schema_refs(r.expr, p_src, p_tgt, v_objetos);
    BEGIN
      EXECUTE format('ALTER TABLE %s.%I ALTER COLUMN %I SET DEFAULT %s', v_tgt, r.tabla, r.col, def);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'clon: default %.% omitido: %', r.tabla, r.col, SQLERRM;
    END;
  END LOOP;

  ---------------------------------------------------------------------------
  -- 8) Vistas (varias pasadas por dependencias entre vistas)
  ---------------------------------------------------------------------------
  FOR v_pass IN 1..12
  LOOP
    v_fallas := 0;
    FOR r IN
      SELECT c.relname::text AS vname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = p_src AND c.relkind = 'v'
      AND NOT EXISTS (
        SELECT 1 FROM pg_class c2 JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
        WHERE n2.nspname = p_tgt AND c2.relname = c.relname AND c2.relkind = 'v'
      )
    LOOP
      SELECT pg_get_viewdef(format('%I.%I', p_src, r.vname)::regclass, true) INTO vdef;
      CONTINUE WHEN vdef IS NULL;
      vdef := public.neura_rewrite_schema_refs(vdef, p_src, p_tgt, v_objetos);
      BEGIN
        EXECUTE format('CREATE VIEW %s.%I AS %s', v_tgt, r.vname, vdef);
      EXCEPTION WHEN OTHERS THEN
        v_fallas := v_fallas + 1;   -- depende de otra vista aun no creada
      END;
    END LOOP;
    EXIT WHEN v_fallas = 0;
  END LOOP;
  IF v_fallas > 0 THEN
    RAISE WARNING 'clon: % vista(s) no pudieron recrearse tras 12 pasadas', v_fallas;
  END IF;

  ---------------------------------------------------------------------------
  -- 9) Vistas materializadas (sin datos)
  ---------------------------------------------------------------------------
  FOR r IN
    SELECT c.relname::text AS mname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = p_src AND c.relkind = 'm'
  LOOP
    SELECT pg_get_viewdef(format('%I.%I', p_src, r.mname)::regclass, true) INTO vdef;
    CONTINUE WHEN vdef IS NULL;
    vdef := public.neura_rewrite_schema_refs(vdef, p_src, p_tgt, v_objetos);
    BEGIN
      EXECUTE format('CREATE MATERIALIZED VIEW %s.%I AS %s WITH NO DATA', v_tgt, r.mname, vdef);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'clon: matview % omitida: %', r.mname, SQLERRM;
    END;
  END LOOP;

  ---------------------------------------------------------------------------
  -- 10) RLS + policies
  ---------------------------------------------------------------------------
  FOR r IN
    SELECT c.relname::text AS tabla, c.relrowsecurity AS rls, c.relforcerowsecurity AS forzada
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = p_src AND c.relkind = 'r' AND c.relname = ANY (v_tablas)
  LOOP
    IF r.rls THEN
      EXECUTE format('ALTER TABLE %s.%I ENABLE ROW LEVEL SECURITY', v_tgt, r.tabla);
    END IF;
    IF r.forzada THEN
      EXECUTE format('ALTER TABLE %s.%I FORCE ROW LEVEL SECURITY', v_tgt, r.tabla);
    END IF;
  END LOOP;

  FOR r IN
    SELECT pol.polname::text AS polname,
           c.relname::text   AS tabla,
           pol.polcmd::text  AS cmd,
           pol.polpermissive AS permissive,
           pg_get_expr(pol.polqual, pol.polrelid)      AS polqual,
           pg_get_expr(pol.polwithcheck, pol.polrelid) AS polcheck,
           ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY (pol.polroles)) AS roles
    FROM pg_policy pol
    JOIN pg_class c     ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = p_src AND c.relname = ANY (v_tablas)
  LOOP
    BEGIN
      qual := public.neura_rewrite_schema_refs(r.polqual,  p_src, p_tgt, v_objetos);
      chk  := public.neura_rewrite_schema_refs(r.polcheck, p_src, p_tgt, v_objetos);

      IF r.roles IS NULL OR coalesce(cardinality(r.roles), 0) = 0 THEN
        roles_cl := '';
      ELSE
        roles_cl := ' TO ' || (SELECT string_agg(quote_ident(x), ', ') FROM unnest(r.roles) AS x);
      END IF;

      EXECUTE format('DROP POLICY IF EXISTS %I ON %s.%I', r.polname, v_tgt, r.tabla);

      IF r.cmd = 'r' THEN
        EXECUTE format('CREATE POLICY %I ON %s.%I AS %s FOR SELECT%s USING (%s)',
          r.polname, v_tgt, r.tabla,
          CASE WHEN r.permissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
          roles_cl, coalesce(qual, 'true'));
      ELSIF r.cmd = 'a' THEN
        EXECUTE format('CREATE POLICY %I ON %s.%I AS %s FOR INSERT%s WITH CHECK (%s)',
          r.polname, v_tgt, r.tabla,
          CASE WHEN r.permissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
          roles_cl, coalesce(chk, qual, 'true'));
      ELSIF r.cmd = 'w' THEN
        EXECUTE format('CREATE POLICY %I ON %s.%I AS %s FOR UPDATE%s USING (%s) WITH CHECK (%s)',
          r.polname, v_tgt, r.tabla,
          CASE WHEN r.permissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
          roles_cl, coalesce(qual, 'true'), coalesce(chk, qual, 'true'));
      ELSIF r.cmd = 'd' THEN
        EXECUTE format('CREATE POLICY %I ON %s.%I AS %s FOR DELETE%s USING (%s)',
          r.polname, v_tgt, r.tabla,
          CASE WHEN r.permissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
          roles_cl, coalesce(qual, 'true'));
      ELSE
        EXECUTE format('CREATE POLICY %I ON %s.%I AS %s FOR ALL%s USING (%s) WITH CHECK (%s)',
          r.polname, v_tgt, r.tabla,
          CASE WHEN r.permissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
          roles_cl, coalesce(qual, 'true'), coalesce(chk, qual, 'true'));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'clon: policy % en % omitida: %', r.polname, r.tabla, SQLERRM;
    END;
  END LOOP;

  ---------------------------------------------------------------------------
  -- 11) Realtime: replicar membresía de publicación
  ---------------------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = v_pub) THEN
    FOR r IN
      SELECT pt.tablename::text AS tabla
      FROM pg_publication_tables pt
      WHERE pt.pubname = v_pub
        AND pt.schemaname = p_src
        AND pt.tablename = ANY (v_tablas)
    LOOP
      BEGIN
        EXECUTE format('ALTER PUBLICATION %I ADD TABLE %I.%I', v_pub, p_tgt, r.tabla);
      EXCEPTION WHEN duplicate_object THEN NULL;
      WHEN OTHERS THEN
        RAISE WARNING 'clon: realtime % omitido: %', r.tabla, SQLERRM;
      END;
    END LOOP;
  END IF;

  RAISE NOTICE 'clon estructural % → % COMPLETO (sin datos)', p_src, p_tgt;
END;
$clone$;


-- =============================================================================
-- PARTE 2 — EJECUTAR LA CLONACIÓN
-- =============================================================================

SELECT public.neura_clonar_schema_estructura('ferrecolor', 'asunhome');


-- =============================================================================
-- PARTE 3 — ALCANCE ASUNHOME SOBRE LA ESTRUCTURA HEREDADA
--
-- Verificado contra el catálogo real de `ferrecolor` (125 tablas).
-- NO se duplica nada que ya exista. Se reparte en dos grupos:
--
--   3.A  RECONCILIACIÓN de tablas que ya vienen del clon:
--        presupuestos · presupuesto_items · cajas · caja_movimientos ·
--        movimientos_inventario · productos
--        → solo ADD COLUMN IF NOT EXISTS y ampliación de CHECKs.
--
--   3.B  TABLAS NUEVAS (10), que Ferrecolor no tiene:
--        marcas · lineas_producto · producto_series · productos_averiados ·
--        servicio_tecnico_ordenes/_items/_historial ·
--        ajuste_stock_autorizados · ajustes_stock · ajustes_stock_items
--
-- Descartado respecto del borrador anterior, por existir ya en Ferrecolor:
--   caja_sesiones      → se usa `cajas`
--   presupuestos_items → se usa `presupuesto_items` (singular)
--
-- Todo idempotente. Las FKs se agregan al final (3.9) solo si el destino existe.
-- =============================================================================

SET search_path = asunhome, public, extensions, pg_catalog;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3.A RECONCILIACIÓN
-- ─────────────────────────────────────────────────────────────────────────────

-- 3.A.1 productos: marca, línea de producto, manejo de series, garantía
ALTER TABLE asunhome.productos
  ADD COLUMN IF NOT EXISTS marca_id       uuid,
  ADD COLUMN IF NOT EXISTS linea_id       uuid,
  ADD COLUMN IF NOT EXISTS maneja_series  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS garantia_meses integer;

CREATE INDEX IF NOT EXISTS idx_productos_marca ON asunhome.productos (marca_id);
CREATE INDEX IF NOT EXISTS idx_productos_linea ON asunhome.productos (linea_id);


-- 3.A.2 presupuestos (HOJA DE PRESUPUESTO)
-- Heredada: numero_control, estado, moneda, subtotal, monto_iva, descuento_total,
-- total, validez_dias, fecha, fecha_vencimiento, forma_pago, plazo_entrega,
-- convertido_pedido_id, convertido_venta_id, datos snapshot del cliente.
-- Falta para el alcance ASUNHOME: origen del presupuesto (venta vs servicio
-- técnico), vínculo a la orden de servicio, vendedor, condiciones y tipo_cambio.
ALTER TABLE asunhome.presupuestos
  ADD COLUMN IF NOT EXISTS origen            text NOT NULL DEFAULT 'venta',
  ADD COLUMN IF NOT EXISTS orden_servicio_id uuid,
  ADD COLUMN IF NOT EXISTS tipo_cambio       numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS vendedor_id       uuid,
  ADD COLUMN IF NOT EXISTS vendedor_nombre   text,
  ADD COLUMN IF NOT EXISTS condiciones       text,
  ADD COLUMN IF NOT EXISTS created_by        uuid,
  ADD COLUMN IF NOT EXISTS updated_by        uuid;

-- Los CHECK se aplican via EXECUTE con el DDL en una sola linea: asi la
-- sentencia no puede partirse ni por plpgsql ni por el cliente SQL, y un
-- eventual fallo queda capturado en runtime en vez de romper el parseo.
DO $p$
BEGIN
  BEGIN
    EXECUTE 'ALTER TABLE asunhome.presupuestos DROP CONSTRAINT IF EXISTS presupuestos_origen_check';
    EXECUTE 'ALTER TABLE asunhome.presupuestos ADD CONSTRAINT presupuestos_origen_check CHECK (origen IN (''venta'',''servicio_tecnico''))';
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'presupuestos_origen_check: %', SQLERRM; END;

  -- Ampliar el estado heredado (creado/enviado/aprobado/rechazado/convertido)
  -- con 'vencido', que hace falta porque la tabla ya maneja validez_dias.
  BEGIN
    EXECUTE 'ALTER TABLE asunhome.presupuestos DROP CONSTRAINT IF EXISTS presupuestos_estado_check';
    EXECUTE 'ALTER TABLE asunhome.presupuestos ADD CONSTRAINT presupuestos_estado_check CHECK (estado IN (''creado'',''enviado'',''aprobado'',''rechazado'',''convertido'',''vencido''))';
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'presupuestos_estado_check: %', SQLERRM; END;
END;
$p$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_presupuestos_empresa_numero_control
  ON asunhome.presupuestos (empresa_id, lower(btrim(numero_control)));
CREATE INDEX IF NOT EXISTS idx_presupuestos_cliente  ON asunhome.presupuestos (cliente_id);
CREATE INDEX IF NOT EXISTS idx_presupuestos_estado   ON asunhome.presupuestos (estado);
CREATE INDEX IF NOT EXISTS idx_presupuestos_fecha    ON asunhome.presupuestos (fecha DESC);
CREATE INDEX IF NOT EXISTS idx_presupuestos_orden_st ON asunhome.presupuestos (orden_servicio_id);


-- 3.A.3 presupuesto_items (singular, tal como está en Ferrecolor)
-- Heredada: producto_nombre, sku, cantidad, unidad_medida, precio_unitario,
-- iva_tipo, subtotal, monto_iva, descuento, total.
ALTER TABLE asunhome.presupuesto_items
  ADD COLUMN IF NOT EXISTS orden         integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS observaciones text;

CREATE INDEX IF NOT EXISTS idx_presupuesto_items_presupuesto
  ON asunhome.presupuesto_items (presupuesto_id, orden);


-- 3.A.4 cajas (REPORTE CAJA — se usa la tabla existente, no una nueva)
-- Heredada: numero_caja, estado (abierta/en_cierre/cerrada), abierta_por,
-- cerrada_por, fecha_apertura, fecha_cierre, monto_apertura,
-- monto_cierre_contado, monto_esperado_efectivo, diferencia, arqueos jsonb.
ALTER TABLE asunhome.cajas
  ADD COLUMN IF NOT EXISTS ubicacion_id uuid;   -- caja de salón vs caja de depósito

CREATE INDEX IF NOT EXISTS idx_cajas_estado ON asunhome.cajas (estado);
CREATE INDEX IF NOT EXISTS idx_cajas_fecha  ON asunhome.cajas (fecha_apertura DESC);


-- 3.A.5 caja_movimientos
-- Heredada: caja_id, tipo (ingreso/egreso/retiro/ajuste), concepto (texto libre),
-- monto, medio_pago (efectivo/tarjeta/transferencia/otro), usuario_id,
-- usuario_email, observacion, venta_id, devolucion_id, anulado_*.
-- Falta: vínculo a orden de servicio técnico y al cliente.
ALTER TABLE asunhome.caja_movimientos
  ADD COLUMN IF NOT EXISTS orden_servicio_id uuid,
  ADD COLUMN IF NOT EXISTS cliente_id        uuid;

CREATE INDEX IF NOT EXISTS idx_caja_mov_caja      ON asunhome.caja_movimientos (caja_id);
CREATE INDEX IF NOT EXISTS idx_caja_mov_fecha     ON asunhome.caja_movimientos (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_caja_mov_tipo      ON asunhome.caja_movimientos (tipo);
CREATE INDEX IF NOT EXISTS idx_caja_mov_venta     ON asunhome.caja_movimientos (venta_id);
CREATE INDEX IF NOT EXISTS idx_caja_mov_orden_st  ON asunhome.caja_movimientos (orden_servicio_id);


-- 3.A.6 movimientos_inventario: transferencias salón ↔ depósito y series
-- Heredada: venta_id, produccion_id, devolucion_id, created_by, usuario_nombre,
-- referencia, fecha, anulado_at/por.
ALTER TABLE asunhome.movimientos_inventario
  ADD COLUMN IF NOT EXISTS ubicacion_origen_id  uuid,
  ADD COLUMN IF NOT EXISTS ubicacion_destino_id uuid,
  ADD COLUMN IF NOT EXISTS serie_id             uuid,
  ADD COLUMN IF NOT EXISTS ajuste_id            uuid,
  ADD COLUMN IF NOT EXISTS orden_servicio_id    uuid,
  ADD COLUMN IF NOT EXISTS observaciones        text;

CREATE INDEX IF NOT EXISTS idx_mov_inv_ubic_origen  ON asunhome.movimientos_inventario (ubicacion_origen_id);
CREATE INDEX IF NOT EXISTS idx_mov_inv_ubic_destino ON asunhome.movimientos_inventario (ubicacion_destino_id);
CREATE INDEX IF NOT EXISTS idx_mov_inv_serie        ON asunhome.movimientos_inventario (serie_id);

-- Los CHECK se AMPLÍAN preservando todos los valores que Ferrecolor ya usa
-- ('produccion' y 'devolucion_venta' incluidos): solo se agregan los nuevos.
DO $mov$
DECLARE
  -- heredados de Ferrecolor (NO se quitan) + nuevos de ASUNHOME
  v_origen text := '''compra'',''venta'',''ajuste_manual'',''inventario_inicial'',''produccion'',''devolucion_venta'','
                || '''transferencia'',''servicio_tecnico'',''averia'',''devolucion_proveedor''';
  v_tipo   text := '''ENTRADA'',''SALIDA'',''AJUSTE'',''TRANSFERENCIA''';
BEGIN
  BEGIN
    EXECUTE 'ALTER TABLE asunhome.movimientos_inventario DROP CONSTRAINT IF EXISTS movimientos_inventario_tipo_check';
    EXECUTE 'ALTER TABLE asunhome.movimientos_inventario ADD CONSTRAINT movimientos_inventario_tipo_check CHECK (tipo IN (' || v_tipo || '))';
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'movimientos_inventario tipo_check: %', SQLERRM; END;

  BEGIN
    EXECUTE 'ALTER TABLE asunhome.movimientos_inventario DROP CONSTRAINT IF EXISTS movimientos_inventario_origen_check';
    EXECUTE 'ALTER TABLE asunhome.movimientos_inventario ADD CONSTRAINT movimientos_inventario_origen_check CHECK (origen IN (' || v_origen || '))';
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'movimientos_inventario origen_check: %', SQLERRM; END;
END;
$mov$;


-- 3.A.7 Búsqueda parcial de clientes por nombre / RUC ("estira por cliente")
CREATE INDEX IF NOT EXISTS idx_clientes_nombre_trgm
  ON asunhome.clientes USING gin (nombre gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_clientes_ruc_trgm
  ON asunhome.clientes USING gin (ruc gin_trgm_ops);


-- ─────────────────────────────────────────────────────────────────────────────
-- 3.B TABLAS NUEVAS (no existen en Ferrecolor)
-- ─────────────────────────────────────────────────────────────────────────────

-- 3.B.1 marcas · REPORTE MARCA
CREATE TABLE IF NOT EXISTS asunhome.marcas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL,
  nombre       text NOT NULL,
  codigo       text,
  descripcion  text,
  proveedor_id uuid,                        -- proveedor habitual de la marca
  activo       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_marcas_empresa_nombre
  ON asunhome.marcas (empresa_id, lower(btrim(nombre)));
CREATE INDEX IF NOT EXISTS idx_marcas_empresa ON asunhome.marcas (empresa_id);
CREATE INDEX IF NOT EXISTS idx_marcas_activo  ON asunhome.marcas (activo);


-- 3.B.2 lineas_producto · REPORTE LINEA DE PRODUCTOS
-- Distinta de `categorias_productos`, que Ferrecolor ya usa para categorías.
CREATE TABLE IF NOT EXISTS asunhome.lineas_producto (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL,
  nombre      text NOT NULL,
  codigo      text,
  descripcion text,
  parent_id   uuid REFERENCES asunhome.lineas_producto(id) ON DELETE SET NULL,
  activo      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lineas_producto_empresa_nombre
  ON asunhome.lineas_producto (empresa_id, lower(btrim(nombre)));
CREATE INDEX IF NOT EXISTS idx_lineas_producto_empresa ON asunhome.lineas_producto (empresa_id);
CREATE INDEX IF NOT EXISTS idx_lineas_producto_parent  ON asunhome.lineas_producto (parent_id);


-- 3.B.3 producto_series · VENTA PRODUCTO SERIAL · carga de obs/nº de serie
-- Una fila por unidad física. Es lo que permite responder
-- "este televisor averiado, ¿de qué proveedor vino?".
CREATE TABLE IF NOT EXISTS asunhome.producto_series (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL,
  producto_id    uuid NOT NULL,
  numero_serie   text NOT NULL,
  estado         text NOT NULL DEFAULT 'en_stock'
                 CHECK (estado IN ('en_stock','reservado','vendido','averiado',
                                   'en_servicio','devuelto_proveedor','baja')),
  ubicacion_id   uuid,                       -- salón / depósito
  proveedor_id   uuid,                       -- ← origen del equipo
  compra_id      uuid,                       -- factura de compra que lo trajo
  venta_id       uuid,
  venta_item_id  uuid,
  cliente_id     uuid,
  costo_unitario numeric,
  precio_venta   numeric,
  fecha_ingreso  timestamptz NOT NULL DEFAULT now(),
  fecha_venta    timestamptz,
  garantia_hasta date,
  observaciones  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_by     uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_producto_series_empresa_serie
  ON asunhome.producto_series (empresa_id, lower(btrim(numero_serie)));
CREATE INDEX IF NOT EXISTS idx_series_producto  ON asunhome.producto_series (producto_id);
CREATE INDEX IF NOT EXISTS idx_series_estado    ON asunhome.producto_series (estado);
CREATE INDEX IF NOT EXISTS idx_series_proveedor ON asunhome.producto_series (proveedor_id);
CREATE INDEX IF NOT EXISTS idx_series_venta     ON asunhome.producto_series (venta_id);
CREATE INDEX IF NOT EXISTS idx_series_cliente   ON asunhome.producto_series (cliente_id);
CREATE INDEX IF NOT EXISTS idx_series_ubicacion ON asunhome.producto_series (ubicacion_id);
CREATE INDEX IF NOT EXISTS idx_series_serie_trgm
  ON asunhome.producto_series USING gin (numero_serie gin_trgm_ops);


-- 3.B.4 productos_averiados
CREATE TABLE IF NOT EXISTS asunhome.productos_averiados (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL,
  producto_id      uuid NOT NULL,
  serie_id         uuid,
  numero_serie     text,
  proveedor_id     uuid,                     -- ← de qué proveedor se adquirió
  compra_id        uuid,
  ubicacion_id     uuid,
  cantidad         numeric NOT NULL DEFAULT 1,
  motivo           text NOT NULL DEFAULT 'fabrica'
                   CHECK (motivo IN ('fabrica','transporte','deposito','cliente',
                                     'exhibicion','desconocido','otro')),
  descripcion      text,
  estado           text NOT NULL DEFAULT 'detectado'
                   CHECK (estado IN ('detectado','en_revision','en_garantia_proveedor',
                                     'reparado','descartado','devuelto_proveedor')),
  costo_estimado   numeric,
  recuperado       boolean NOT NULL DEFAULT false,
  fecha_deteccion  timestamptz NOT NULL DEFAULT now(),
  fecha_resolucion timestamptz,
  reportado_por    uuid,
  resuelto_por     uuid,
  observaciones    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_averiados_empresa   ON asunhome.productos_averiados (empresa_id);
CREATE INDEX IF NOT EXISTS idx_averiados_producto  ON asunhome.productos_averiados (producto_id);
CREATE INDEX IF NOT EXISTS idx_averiados_proveedor ON asunhome.productos_averiados (proveedor_id);
CREATE INDEX IF NOT EXISTS idx_averiados_estado    ON asunhome.productos_averiados (estado);
CREATE INDEX IF NOT EXISTS idx_averiados_serie     ON asunhome.productos_averiados (serie_id);


-- 3.B.5 Servicio técnico
CREATE TABLE IF NOT EXISTS asunhome.servicio_tecnico_ordenes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL,
  numero             text NOT NULL,
  cliente_id         uuid,
  cliente_nombre     text,                   -- snapshot, para "estirar" por nombre
  cliente_ruc        text,
  cliente_telefono   text,
  cliente_direccion  text,
  producto_id        uuid,
  serie_id           uuid,
  numero_serie       text,
  marca_id           uuid,
  equipo_descripcion text,
  accesorios         text,
  tipo               text NOT NULL DEFAULT 'reparacion'
                     CHECK (tipo IN ('reparacion','garantia','instalacion',
                                     'mantenimiento','diagnostico')),
  estado             text NOT NULL DEFAULT 'recibido'
                     CHECK (estado IN ('recibido','en_diagnostico','presupuestado',
                                       'aprobado','en_reparacion','listo',
                                       'entregado','rechazado','anulado')),
  prioridad          text NOT NULL DEFAULT 'normal'
                     CHECK (prioridad IN ('baja','normal','alta','urgente')),
  falla_reportada    text,
  diagnostico        text,
  trabajo_realizado  text,
  tecnico_id         uuid,
  tecnico_nombre     text,
  proveedor_id       uuid,                   -- garantía gestionada con proveedor
  presupuesto_id     uuid,
  costo_repuestos    numeric NOT NULL DEFAULT 0,
  costo_mano_obra    numeric NOT NULL DEFAULT 0,
  total              numeric NOT NULL DEFAULT 0,
  fecha_ingreso      timestamptz NOT NULL DEFAULT now(),
  fecha_promesa      timestamptz,
  fecha_entrega      timestamptz,
  observaciones      text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  updated_by         uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_st_ordenes_empresa_numero
  ON asunhome.servicio_tecnico_ordenes (empresa_id, lower(btrim(numero)));
CREATE INDEX IF NOT EXISTS idx_st_ordenes_cliente ON asunhome.servicio_tecnico_ordenes (cliente_id);
CREATE INDEX IF NOT EXISTS idx_st_ordenes_estado  ON asunhome.servicio_tecnico_ordenes (estado);
CREATE INDEX IF NOT EXISTS idx_st_ordenes_tecnico ON asunhome.servicio_tecnico_ordenes (tecnico_id);
CREATE INDEX IF NOT EXISTS idx_st_ordenes_serie   ON asunhome.servicio_tecnico_ordenes (serie_id);
CREATE INDEX IF NOT EXISTS idx_st_ordenes_fecha   ON asunhome.servicio_tecnico_ordenes (fecha_ingreso DESC);
CREATE INDEX IF NOT EXISTS idx_st_ordenes_cliente_nombre_trgm
  ON asunhome.servicio_tecnico_ordenes USING gin (cliente_nombre gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_st_ordenes_cliente_ruc_trgm
  ON asunhome.servicio_tecnico_ordenes USING gin (cliente_ruc gin_trgm_ops);

CREATE TABLE IF NOT EXISTS asunhome.servicio_tecnico_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL,
  orden_id        uuid NOT NULL REFERENCES asunhome.servicio_tecnico_ordenes(id) ON DELETE CASCADE,
  producto_id     uuid,
  descripcion     text NOT NULL,
  tipo            text NOT NULL DEFAULT 'repuesto'
                  CHECK (tipo IN ('repuesto','mano_obra','servicio_externo','otro')),
  cantidad        numeric NOT NULL DEFAULT 1,
  costo_unitario  numeric NOT NULL DEFAULT 0,
  precio_unitario numeric NOT NULL DEFAULT 0,
  subtotal        numeric NOT NULL DEFAULT 0,
  movimiento_id   uuid,                      -- movimiento de stock generado
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_st_items_orden    ON asunhome.servicio_tecnico_items (orden_id);
CREATE INDEX IF NOT EXISTS idx_st_items_producto ON asunhome.servicio_tecnico_items (producto_id);

CREATE TABLE IF NOT EXISTS asunhome.servicio_tecnico_historial (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL,
  orden_id        uuid NOT NULL REFERENCES asunhome.servicio_tecnico_ordenes(id) ON DELETE CASCADE,
  estado_anterior text,
  estado_nuevo    text NOT NULL,
  comentario      text,
  usuario_id      uuid,
  usuario_nombre  text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_st_historial_orden
  ON asunhome.servicio_tecnico_historial (orden_id, created_at DESC);


-- 3.B.6 Ajustes de stock + usuario único autorizado
CREATE TABLE IF NOT EXISTS asunhome.ajuste_stock_autorizados (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL,
  usuario_id    uuid NOT NULL,
  usuario_email text,
  activo        boolean NOT NULL DEFAULT true,
  asignado_por  uuid,
  motivo        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- "Usuario único ajuste": a lo sumo UN autorizado activo por empresa.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ajuste_autorizado_unico_por_empresa
  ON asunhome.ajuste_stock_autorizados (empresa_id)
  WHERE activo = true;
CREATE INDEX IF NOT EXISTS idx_ajuste_autorizados_usuario
  ON asunhome.ajuste_stock_autorizados (usuario_id);

CREATE TABLE IF NOT EXISTS asunhome.ajustes_stock (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id           uuid NOT NULL,
  numero               text NOT NULL,
  tipo                 text NOT NULL DEFAULT 'correccion'
                       CHECK (tipo IN ('conteo','merma','correccion','transferencia')),
  ubicacion_id         uuid,
  ubicacion_destino_id uuid,                 -- solo transferencia salón ↔ depósito
  motivo               text NOT NULL,
  estado               text NOT NULL DEFAULT 'borrador'
                       CHECK (estado IN ('borrador','aplicado','anulado')),
  fecha                timestamptz NOT NULL DEFAULT now(),
  solicitado_por       uuid,
  aplicado_por         uuid,
  aplicado_at          timestamptz,
  anulado_por          uuid,
  anulado_at           timestamptz,
  observaciones        text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ajustes_stock_empresa_numero
  ON asunhome.ajustes_stock (empresa_id, lower(btrim(numero)));
CREATE INDEX IF NOT EXISTS idx_ajustes_stock_estado ON asunhome.ajustes_stock (estado);
CREATE INDEX IF NOT EXISTS idx_ajustes_stock_fecha  ON asunhome.ajustes_stock (fecha DESC);

CREATE TABLE IF NOT EXISTS asunhome.ajustes_stock_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL,
  ajuste_id      uuid NOT NULL REFERENCES asunhome.ajustes_stock(id) ON DELETE CASCADE,
  producto_id    uuid NOT NULL,
  serie_id       uuid,
  stock_sistema  numeric NOT NULL DEFAULT 0,
  stock_fisico   numeric NOT NULL DEFAULT 0,
  diferencia     numeric GENERATED ALWAYS AS (stock_fisico - stock_sistema) STORED,
  costo_unitario numeric NOT NULL DEFAULT 0,
  movimiento_id  uuid,
  observaciones  text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ajustes_items_ajuste   ON asunhome.ajustes_stock_items (ajuste_id);
CREATE INDEX IF NOT EXISTS idx_ajustes_items_producto ON asunhome.ajustes_stock_items (producto_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- 3.9 FOREIGN KEYS — se crean solo si la tabla referenciada existe
-- ─────────────────────────────────────────────────────────────────────────────

DO $fks$
DECLARE
  v_sch text := 'asunhome';
  f     RECORD;
BEGIN
  FOR f IN
    SELECT * FROM (VALUES
      -- tablas nuevas
      ('marcas',                    'empresa_id',           'empresas',                 'CASCADE'),
      ('marcas',                    'proveedor_id',         'proveedores',              'SET NULL'),
      ('lineas_producto',           'empresa_id',           'empresas',                 'CASCADE'),
      ('producto_series',           'empresa_id',           'empresas',                 'CASCADE'),
      ('producto_series',           'producto_id',          'productos',                'RESTRICT'),
      ('producto_series',           'ubicacion_id',         'inventario_ubicaciones',   'SET NULL'),
      ('producto_series',           'proveedor_id',         'proveedores',              'SET NULL'),
      ('producto_series',           'compra_id',            'compras',                  'SET NULL'),
      ('producto_series',           'venta_id',             'ventas',                   'SET NULL'),
      ('producto_series',           'venta_item_id',        'ventas_items',             'SET NULL'),
      ('producto_series',           'cliente_id',           'clientes',                 'SET NULL'),
      ('productos_averiados',       'empresa_id',           'empresas',                 'CASCADE'),
      ('productos_averiados',       'producto_id',          'productos',                'RESTRICT'),
      ('productos_averiados',       'serie_id',             'producto_series',          'SET NULL'),
      ('productos_averiados',       'proveedor_id',         'proveedores',              'SET NULL'),
      ('productos_averiados',       'compra_id',            'compras',                  'SET NULL'),
      ('productos_averiados',       'ubicacion_id',         'inventario_ubicaciones',   'SET NULL'),
      ('servicio_tecnico_ordenes',  'empresa_id',           'empresas',                 'CASCADE'),
      ('servicio_tecnico_ordenes',  'cliente_id',           'clientes',                 'SET NULL'),
      ('servicio_tecnico_ordenes',  'producto_id',          'productos',                'SET NULL'),
      ('servicio_tecnico_ordenes',  'serie_id',             'producto_series',          'SET NULL'),
      ('servicio_tecnico_ordenes',  'marca_id',             'marcas',                   'SET NULL'),
      ('servicio_tecnico_ordenes',  'proveedor_id',         'proveedores',              'SET NULL'),
      ('servicio_tecnico_ordenes',  'presupuesto_id',       'presupuestos',             'SET NULL'),
      ('servicio_tecnico_items',    'empresa_id',           'empresas',                 'CASCADE'),
      ('servicio_tecnico_items',    'producto_id',          'productos',                'SET NULL'),
      ('servicio_tecnico_items',    'movimiento_id',        'movimientos_inventario',   'SET NULL'),
      ('servicio_tecnico_historial','empresa_id',           'empresas',                 'CASCADE'),
      ('ajuste_stock_autorizados',  'empresa_id',           'empresas',                 'CASCADE'),
      ('ajustes_stock',             'empresa_id',           'empresas',                 'CASCADE'),
      ('ajustes_stock',             'ubicacion_id',         'inventario_ubicaciones',   'SET NULL'),
      ('ajustes_stock',             'ubicacion_destino_id', 'inventario_ubicaciones',   'SET NULL'),
      ('ajustes_stock_items',       'empresa_id',           'empresas',                 'CASCADE'),
      ('ajustes_stock_items',       'producto_id',          'productos',                'RESTRICT'),
      ('ajustes_stock_items',       'serie_id',             'producto_series',          'SET NULL'),
      ('ajustes_stock_items',       'movimiento_id',        'movimientos_inventario',   'SET NULL'),
      -- columnas nuevas sobre tablas heredadas
      ('productos',                 'marca_id',             'marcas',                   'SET NULL'),
      ('productos',                 'linea_id',             'lineas_producto',          'SET NULL'),
      ('presupuestos',              'orden_servicio_id',    'servicio_tecnico_ordenes', 'SET NULL'),
      ('cajas',                     'ubicacion_id',         'inventario_ubicaciones',   'SET NULL'),
      ('caja_movimientos',          'orden_servicio_id',    'servicio_tecnico_ordenes', 'SET NULL'),
      ('caja_movimientos',          'cliente_id',           'clientes',                 'SET NULL'),
      ('movimientos_inventario',    'ubicacion_origen_id',  'inventario_ubicaciones',   'SET NULL'),
      ('movimientos_inventario',    'ubicacion_destino_id', 'inventario_ubicaciones',   'SET NULL'),
      ('movimientos_inventario',    'serie_id',             'producto_series',          'SET NULL'),
      ('movimientos_inventario',    'ajuste_id',            'ajustes_stock',            'SET NULL'),
      ('movimientos_inventario',    'orden_servicio_id',    'servicio_tecnico_ordenes', 'SET NULL')
    ) AS t(tabla, col, ref_tabla, on_delete)
  LOOP
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = v_sch AND table_name = f.tabla AND column_name = f.col
    );
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = v_sch AND c.relname = f.ref_tabla AND c.relkind = 'r'
    );

    BEGIN
      EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I',
        v_sch, f.tabla, 'fk_' || f.tabla || '_' || f.col);
      EXECUTE format(
        'ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I.%I(id) ON DELETE %s',
        v_sch, f.tabla, 'fk_' || f.tabla || '_' || f.col, f.col, v_sch, f.ref_tabla, f.on_delete
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'FK %.% → %: %', f.tabla, f.col, f.ref_tabla, SQLERRM;
    END;
  END LOOP;
END;
$fks$;


-- =============================================================================
-- PARTE 4 — VISTAS DE REPORTES
--
-- Escritas contra los nombres de columna REALES de Ferrecolor.
-- Cada una en su bloque: un fallo emite WARNING y el script sigue.
-- =============================================================================

-- REPORTES DE VENTAS (línea a línea, con marca y línea de producto)
DO $v$ BEGIN EXECUTE $q$
CREATE OR REPLACE VIEW asunhome.v_reporte_ventas AS
SELECT
  v.id AS venta_id, v.empresa_id, v.fecha, v.numero_control, v.estado,
  v.tipo_venta, v.moneda, v.metodo_pago, v.caja_id, v.cliente_id,
  cl.nombre AS cliente, cl.ruc AS cliente_ruc,
  vi.id AS item_id, vi.producto_id, vi.producto_nombre, vi.sku,
  p.marca_id, m.nombre AS marca,
  p.linea_id, l.nombre AS linea_producto,
  vi.cantidad, vi.precio_venta, vi.subtotal, vi.monto_iva, vi.total_linea,
  p.costo_promedio,
  (vi.cantidad * coalesce(p.costo_promedio, 0))               AS costo_total_linea,
  (vi.subtotal - vi.cantidad * coalesce(p.costo_promedio, 0)) AS margen_bruto
FROM asunhome.ventas v
JOIN asunhome.ventas_items vi        ON vi.venta_id = v.id
LEFT JOIN asunhome.clientes cl       ON cl.id = v.cliente_id
LEFT JOIN asunhome.productos p       ON p.id = vi.producto_id
LEFT JOIN asunhome.marcas m          ON m.id = p.marca_id
LEFT JOIN asunhome.lineas_producto l ON l.id = p.linea_id
WHERE v.anulada_at IS NULL
$q$; EXCEPTION WHEN OTHERS THEN RAISE WARNING 'v_reporte_ventas: %', SQLERRM; END; $v$;


-- REPORTE STOCK
DO $v$ BEGIN EXECUTE $q$
CREATE OR REPLACE VIEW asunhome.v_reporte_stock AS
SELECT
  p.id AS producto_id, p.empresa_id, p.nombre AS producto, p.sku,
  p.codigo_barras, m.nombre AS marca, l.nombre AS linea_producto,
  cat.nombre AS categoria, u.nombre AS ubicacion_principal,
  p.stock_actual, p.stock_minimo,
  (p.stock_actual <= p.stock_minimo)                AS bajo_minimo,
  p.costo_promedio, p.precio_venta,
  (p.stock_actual * coalesce(p.costo_promedio, 0))  AS valor_costo,
  (p.stock_actual * coalesce(p.precio_venta, 0))    AS valor_venta,
  p.maneja_series, p.activo
FROM asunhome.productos p
LEFT JOIN asunhome.marcas m                    ON m.id = p.marca_id
LEFT JOIN asunhome.lineas_producto l           ON l.id = p.linea_id
LEFT JOIN asunhome.categorias_productos cat    ON cat.id = p.categoria_principal_id
LEFT JOIN asunhome.inventario_ubicaciones u    ON u.id = p.ubicacion_principal_id
$q$; EXCEPTION WHEN OTHERS THEN RAISE WARNING 'v_reporte_stock: %', SQLERRM; END; $v$;


-- INVENTARIO STOCK SALON / STOCK DEPOSITO
DO $v$ BEGIN EXECUTE $q$
CREATE OR REPLACE VIEW asunhome.v_reporte_stock_ubicacion AS
SELECT
  su.empresa_id, su.producto_id, p.nombre AS producto, p.sku,
  m.nombre AS marca,
  u.id AS ubicacion_id, u.nombre AS ubicacion,
  u.tipo AS ubicacion_tipo,                  -- 'salon' | 'deposito' | ...
  su.stock_actual, su.stock_minimo, su.stock_maximo,
  (su.stock_actual * coalesce(p.costo_promedio, 0)) AS valor_costo
FROM asunhome.inventario_stock_ubicacion su
JOIN asunhome.inventario_ubicaciones u ON u.id = su.ubicacion_id
JOIN asunhome.productos p              ON p.id = su.producto_id
LEFT JOIN asunhome.marcas m            ON m.id = p.marca_id
$q$; EXCEPTION WHEN OTHERS THEN RAISE WARNING 'v_reporte_stock_ubicacion: %', SQLERRM; END; $v$;


-- REPORTE LINEA DE PRODUCTOS
DO $v$ BEGIN EXECUTE $q$
CREATE OR REPLACE VIEW asunhome.v_reporte_linea_producto AS
SELECT
  l.empresa_id, l.id AS linea_id, l.nombre AS linea_producto,
  count(DISTINCT p.id)                                AS productos,
  coalesce(sum(p.stock_actual), 0)                    AS stock_total,
  coalesce(sum(p.stock_actual * p.costo_promedio), 0) AS valor_costo,
  coalesce(sum(p.stock_actual * p.precio_venta), 0)   AS valor_venta
FROM asunhome.lineas_producto l
LEFT JOIN asunhome.productos p ON p.linea_id = l.id
GROUP BY l.empresa_id, l.id, l.nombre
$q$; EXCEPTION WHEN OTHERS THEN RAISE WARNING 'v_reporte_linea_producto: %', SQLERRM; END; $v$;


-- REPORTE MARCA
DO $v$ BEGIN EXECUTE $q$
CREATE OR REPLACE VIEW asunhome.v_reporte_marca AS
SELECT
  m.empresa_id, m.id AS marca_id, m.nombre AS marca,
  count(DISTINCT p.id)                                AS productos,
  coalesce(sum(p.stock_actual), 0)                    AS stock_total,
  coalesce(sum(p.stock_actual * p.costo_promedio), 0) AS valor_costo,
  coalesce(sum(p.stock_actual * p.precio_venta), 0)   AS valor_venta
FROM asunhome.marcas m
LEFT JOIN asunhome.productos p ON p.marca_id = m.id
GROUP BY m.empresa_id, m.id, m.nombre
$q$; EXCEPTION WHEN OTHERS THEN RAISE WARNING 'v_reporte_marca: %', SQLERRM; END; $v$;


-- REPORTE PROVEEDOR
DO $v$ BEGIN EXECUTE $q$
CREATE OR REPLACE VIEW asunhome.v_reporte_proveedor AS
SELECT
  c.empresa_id, c.proveedor_id, pr.nombre AS proveedor, pr.ruc,
  count(*)                     AS compras,
  coalesce(sum(c.cantidad), 0) AS unidades,
  coalesce(sum(c.total), 0)    AS total_comprado,
  min(c.fecha)                 AS primera_compra,
  max(c.fecha)                 AS ultima_compra
FROM asunhome.compras c
LEFT JOIN asunhome.proveedores pr ON pr.id = c.proveedor_id
WHERE c.anulada_at IS NULL
GROUP BY c.empresa_id, c.proveedor_id, pr.nombre, pr.ruc
$q$; EXCEPTION WHEN OTHERS THEN RAISE WARNING 'v_reporte_proveedor: %', SQLERRM; END; $v$;


-- COSTOS / PRECIO VENTA
DO $v$ BEGIN EXECUTE $q$
CREATE OR REPLACE VIEW asunhome.v_costos_precios AS
SELECT
  p.empresa_id, p.id AS producto_id, p.nombre AS producto, p.sku,
  m.nombre AS marca, l.nombre AS linea_producto,
  p.costo_promedio, p.precio_venta, p.precio_mayorista, p.precio_distribuidor,
  (p.precio_venta - p.costo_promedio) AS margen_gs,
  CASE WHEN coalesce(p.costo_promedio, 0) > 0
       THEN round(((p.precio_venta - p.costo_promedio) / p.costo_promedio) * 100, 2)
  END AS margen_pct,
  p.activo
FROM asunhome.productos p
LEFT JOIN asunhome.marcas m          ON m.id = p.marca_id
LEFT JOIN asunhome.lineas_producto l ON l.id = p.linea_id
$q$; EXCEPTION WHEN OTHERS THEN RAISE WARNING 'v_costos_precios: %', SQLERRM; END; $v$;


-- REPORTE CAJA (sobre `cajas` + `caja_movimientos` heredadas)
DO $v$ BEGIN EXECUTE $q$
CREATE OR REPLACE VIEW asunhome.v_reporte_caja AS
SELECT
  c.empresa_id,
  c.id AS caja_id, c.numero_caja, c.estado AS caja_estado,
  c.abierta_por, c.cerrada_por,
  c.fecha_apertura, c.fecha_cierre,
  c.monto_apertura, c.monto_cierre_contado, c.monto_esperado_efectivo, c.diferencia,
  mv.id AS movimiento_id, mv.created_at AS fecha,
  mv.tipo, mv.concepto, mv.medio_pago, mv.monto,
  CASE WHEN mv.tipo = 'ingreso' THEN mv.monto ELSE -mv.monto END AS monto_con_signo,
  mv.usuario_id, mv.usuario_email,
  mv.venta_id, mv.devolucion_id, mv.orden_servicio_id, mv.cliente_id,
  mv.observacion,
  (mv.anulado_at IS NOT NULL) AS anulado
FROM asunhome.cajas c
LEFT JOIN asunhome.caja_movimientos mv ON mv.caja_id = c.id
$q$; EXCEPTION WHEN OTHERS THEN RAISE WARNING 'v_reporte_caja: %', SQLERRM; END; $v$;


-- HISTORIAL DE COMPRAS DEL CLIENTE
DO $v$ BEGIN EXECUTE $q$
CREATE OR REPLACE VIEW asunhome.v_cliente_historial_compras AS
SELECT
  v.empresa_id, v.cliente_id, cl.nombre AS cliente, cl.ruc,
  v.id AS venta_id, v.numero_control, v.fecha, v.estado, v.tipo_venta,
  v.moneda, v.metodo_pago, v.total,
  count(vi.id)                  AS items,
  coalesce(sum(vi.cantidad), 0) AS unidades
FROM asunhome.ventas v
JOIN asunhome.clientes cl          ON cl.id = v.cliente_id
LEFT JOIN asunhome.ventas_items vi ON vi.venta_id = v.id
WHERE v.anulada_at IS NULL
GROUP BY v.empresa_id, v.cliente_id, cl.nombre, cl.ruc, v.id, v.numero_control,
         v.fecha, v.estado, v.tipo_venta, v.moneda, v.metodo_pago, v.total
$q$; EXCEPTION WHEN OTHERS THEN RAISE WARNING 'v_cliente_historial_compras: %', SQLERRM; END; $v$;


-- TRAZABILIDAD POR SERIE: equipo averiado → proveedor de origen
DO $v$ BEGIN EXECUTE $q$
CREATE OR REPLACE VIEW asunhome.v_trazabilidad_series AS
SELECT
  s.empresa_id, s.id AS serie_id, s.numero_serie, s.estado,
  p.id AS producto_id, p.nombre AS producto, p.sku,
  m.nombre AS marca, l.nombre AS linea_producto,
  pr.id AS proveedor_id, pr.nombre AS proveedor, pr.ruc AS proveedor_ruc,
  pr.telefono AS proveedor_telefono,
  s.compra_id, co.numero_factura AS compra_numero_factura, s.fecha_ingreso,
  s.venta_id, s.cliente_id, cl.nombre AS cliente, s.fecha_venta, s.garantia_hasta,
  u.nombre AS ubicacion,
  av.id AS averia_id, av.estado AS averia_estado, av.motivo AS averia_motivo,
  av.fecha_deteccion,
  s.observaciones
FROM asunhome.producto_series s
JOIN asunhome.productos p                   ON p.id = s.producto_id
LEFT JOIN asunhome.marcas m                 ON m.id = p.marca_id
LEFT JOIN asunhome.lineas_producto l        ON l.id = p.linea_id
LEFT JOIN asunhome.proveedores pr           ON pr.id = s.proveedor_id
LEFT JOIN asunhome.compras co               ON co.id = s.compra_id
LEFT JOIN asunhome.clientes cl              ON cl.id = s.cliente_id
LEFT JOIN asunhome.inventario_ubicaciones u ON u.id = s.ubicacion_id
LEFT JOIN asunhome.productos_averiados av   ON av.serie_id = s.id
$q$; EXCEPTION WHEN OTHERS THEN RAISE WARNING 'v_trazabilidad_series: %', SQLERRM; END; $v$;


-- SERVICIO TECNICO: tablero de órdenes
DO $v$ BEGIN EXECUTE $q$
CREATE OR REPLACE VIEW asunhome.v_servicio_tecnico AS
SELECT
  o.empresa_id, o.id AS orden_id, o.numero, o.estado, o.tipo, o.prioridad,
  o.cliente_id, coalesce(cl.nombre, o.cliente_nombre) AS cliente,
  coalesce(cl.ruc, o.cliente_ruc) AS cliente_ruc,
  coalesce(cl.telefono, o.cliente_telefono) AS cliente_telefono,
  o.producto_id, p.nombre AS producto, o.numero_serie,
  m.nombre AS marca, pr.nombre AS proveedor,
  o.tecnico_id, o.tecnico_nombre,
  o.falla_reportada, o.diagnostico, o.trabajo_realizado,
  o.costo_repuestos, o.costo_mano_obra, o.total,
  o.fecha_ingreso, o.fecha_promesa, o.fecha_entrega,
  (now() - o.fecha_ingreso)                                  AS antiguedad,
  (o.fecha_promesa IS NOT NULL
   AND o.fecha_promesa < now()
   AND o.estado NOT IN ('entregado','rechazado','anulado'))  AS vencida,
  o.presupuesto_id, ps.numero_control AS presupuesto_numero
FROM asunhome.servicio_tecnico_ordenes o
LEFT JOIN asunhome.clientes cl     ON cl.id = o.cliente_id
LEFT JOIN asunhome.productos p     ON p.id = o.producto_id
LEFT JOIN asunhome.marcas m        ON m.id = o.marca_id
LEFT JOIN asunhome.proveedores pr  ON pr.id = o.proveedor_id
LEFT JOIN asunhome.presupuestos ps ON ps.id = o.presupuesto_id
$q$; EXCEPTION WHEN OTHERS THEN RAISE WARNING 'v_servicio_tecnico: %', SQLERRM; END; $v$;


-- =============================================================================
-- PARTE 5 — RLS DE LAS TABLAS NUEVAS + GRANTS + EXPOSICIÓN
--
-- Las tablas heredadas ya traen su RLS y sus policies desde el clon (PARTE 2).
-- Acá solo se cubren las 10 tablas nuevas.
-- =============================================================================

DO $rls$
DECLARE
  v_sch    text := 'asunhome';
  v_tabla  text;
  v_fn     boolean;
  v_qual   text;
  v_nuevas text[] := ARRAY[
    'marcas','lineas_producto','producto_series','productos_averiados',
    'servicio_tecnico_ordenes','servicio_tecnico_items','servicio_tecnico_historial',
    'ajuste_stock_autorizados','ajustes_stock','ajustes_stock_items'
  ];
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = v_sch AND p.proname = 'puede_acceder_empresa'
  ) INTO v_fn;

  IF v_fn THEN
    v_qual := format('%I.puede_acceder_empresa(empresa_id)', v_sch);
  ELSE
    v_qual := 'true';
    RAISE WARNING
      'No se encontró %.puede_acceder_empresa(uuid): las tablas nuevas quedan con RLS permisiva para `authenticated`. Revisá las policies antes de exponer la instancia.',
      v_sch;
  END IF;

  FOREACH v_tabla IN ARRAY v_nuevas
  LOOP
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = v_sch AND c.relname = v_tabla AND c.relkind = 'r'
    );

    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', v_sch, v_tabla);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', v_tabla || '_all', v_sch, v_tabla);
    EXECUTE format(
      'CREATE POLICY %I ON %I.%I FOR ALL TO authenticated USING (%s) WITH CHECK (%s)',
      v_tabla || '_all', v_sch, v_tabla, v_qual, v_qual
    );
  END LOOP;
END;
$rls$;


-- ── Grants ───────────────────────────────────────────────────────────────────

GRANT USAGE ON SCHEMA asunhome TO postgres, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA asunhome TO authenticated;
GRANT ALL                            ON ALL TABLES    IN SCHEMA asunhome TO postgres, service_role;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA asunhome TO authenticated;
GRANT ALL                            ON ALL SEQUENCES IN SCHEMA asunhome TO postgres, service_role;
GRANT EXECUTE                        ON ALL ROUTINES  IN SCHEMA asunhome TO authenticated, service_role;
GRANT ALL                            ON ALL ROUTINES  IN SCHEMA asunhome TO postgres;

-- `anon` no recibe permisos de datos: el ERP exige sesión autenticada.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA asunhome
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA asunhome
  GRANT ALL ON TABLES TO postgres, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA asunhome
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA asunhome
  GRANT ALL ON SEQUENCES TO postgres, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA asunhome
  GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;


-- ── Exponer el schema en PostgREST ──────────────────────────────────────────
--   PGRST_DB_SCHEMAS=public,graphql_public,asunhome
--   PGRST_DB_EXTRA_SEARCH_PATH=public,extensions,asunhome
-- Reiniciar el servicio `rest` tras cambiarlo. El NOTIFY recarga el cache.
NOTIFY pgrst, 'reload schema';


-- =============================================================================
-- PARTE 6 — VERIFICACIÓN
-- =============================================================================

-- 6.1 Origen vs destino
SELECT 'tablas' AS objeto,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ferrecolor' AND c.relkind='r') AS ferrecolor,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='asunhome'   AND c.relkind='r') AS asunhome
UNION ALL SELECT 'vistas',
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ferrecolor' AND c.relkind='v'),
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='asunhome'   AND c.relkind='v')
UNION ALL SELECT 'funciones',
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='ferrecolor'),
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='asunhome')
UNION ALL SELECT 'indices',
  (SELECT count(*) FROM pg_indexes WHERE schemaname='ferrecolor'),
  (SELECT count(*) FROM pg_indexes WHERE schemaname='asunhome')
UNION ALL SELECT 'policies',
  (SELECT count(*) FROM pg_policies WHERE schemaname='ferrecolor'),
  (SELECT count(*) FROM pg_policies WHERE schemaname='asunhome');

-- 6.2 Tablas del origen que faltan en el destino (esperado: 0 filas)
SELECT c.relname AS falta_en_asunhome
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'ferrecolor' AND c.relkind = 'r'
  AND NOT EXISTS (
    SELECT 1 FROM pg_class c2 JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
    WHERE n2.nspname = 'asunhome' AND c2.relname = c.relname)
ORDER BY 1;

-- 6.3 Referencias residuales al origen (esperado: 0 filas)
SELECT 'constraint' AS tipo, cf.relname AS objeto, c.conname AS nombre
FROM pg_constraint c
JOIN pg_class cf ON cf.oid = c.conrelid
JOIN pg_namespace nf ON nf.oid = cf.relnamespace
WHERE nf.nspname = 'asunhome' AND pg_get_constraintdef(c.oid) ~ '\mferrecolor\M'
UNION ALL
SELECT 'funcion', p.proname, p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'asunhome' AND p.prokind IN ('f','p')
  AND pg_get_functiondef(p.oid) ~ '\mferrecolor\M';

-- 6.4 El destino debe estar VACÍO de datos (esperado: 0 filas)
SELECT c.relname AS tabla, c.reltuples::bigint AS filas_estimadas
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'asunhome' AND c.relkind = 'r' AND c.reltuples > 0
ORDER BY 2 DESC;

-- 6.5 Las 10 tablas nuevas (esperado: 10 filas)
SELECT c.relname AS tabla_nueva
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'asunhome' AND c.relkind = 'r'
  AND c.relname IN ('marcas','lineas_producto','producto_series','productos_averiados',
                    'servicio_tecnico_ordenes','servicio_tecnico_items','servicio_tecnico_historial',
                    'ajuste_stock_autorizados','ajustes_stock','ajustes_stock_items')
ORDER BY 1;

-- 6.6 Columnas nuevas sobre tablas heredadas (esperado: 20 filas)
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'asunhome'
  AND (table_name, column_name) IN (
    ('productos','marca_id'),('productos','linea_id'),('productos','maneja_series'),('productos','garantia_meses'),
    ('presupuestos','origen'),('presupuestos','orden_servicio_id'),('presupuestos','tipo_cambio'),
    ('presupuestos','vendedor_id'),('presupuestos','vendedor_nombre'),('presupuestos','condiciones'),
    ('presupuesto_items','orden'),('presupuesto_items','observaciones'),
    ('cajas','ubicacion_id'),
    ('caja_movimientos','orden_servicio_id'),('caja_movimientos','cliente_id'),
    ('movimientos_inventario','ubicacion_origen_id'),('movimientos_inventario','ubicacion_destino_id'),
    ('movimientos_inventario','serie_id'),('movimientos_inventario','ajuste_id'),
    ('movimientos_inventario','orden_servicio_id'))
ORDER BY 1, 2;

-- 6.7 Los CHECK ampliados conservan los valores heredados
SELECT cf.relname AS tabla, con.conname, pg_get_constraintdef(con.oid) AS definicion
FROM pg_constraint con
JOIN pg_class cf ON cf.oid = con.conrelid
JOIN pg_namespace n ON n.oid = cf.relnamespace
WHERE n.nspname = 'asunhome' AND con.contype = 'c'
  AND con.conname IN ('movimientos_inventario_tipo_check','movimientos_inventario_origen_check',
                      'presupuestos_estado_check','presupuestos_origen_check')
ORDER BY 1, 2;


-- =============================================================================
-- OPCIONAL — Semillas mínimas (ejecutar DESPUÉS de crear la empresa)
-- Reemplazar '<EMPRESA_UUID>' / '<USUARIO_UUID>' y descomentar.
-- =============================================================================
-- INSERT INTO asunhome.inventario_ubicaciones (empresa_id, nombre, codigo, tipo)
-- VALUES ('<EMPRESA_UUID>', 'Salón', 'SALON', 'salon'),
--        ('<EMPRESA_UUID>', 'Depósito', 'DEPO', 'deposito');
--
-- INSERT INTO asunhome.ajuste_stock_autorizados (empresa_id, usuario_id, usuario_email, motivo)
-- VALUES ('<EMPRESA_UUID>', '<USUARIO_UUID>', 'encargado@asunhome.com.py', 'Encargado de inventario');


-- =============================================================================
-- LIMPIEZA OPCIONAL — quitar los helpers de clonación de `public`
-- =============================================================================
-- DROP FUNCTION IF EXISTS public.neura_clonar_schema_estructura(text, text);
-- DROP FUNCTION IF EXISTS public.neura_rewrite_schema_refs(text, text, text, text[]);
