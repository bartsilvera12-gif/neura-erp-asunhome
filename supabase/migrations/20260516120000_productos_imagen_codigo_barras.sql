-- =============================================================================
-- Fase 3 (Inventario/Ventas): imagen de producto + codigo de barras interno
--
-- Cambios ADITIVOS multi-schema sobre tabla `productos`:
--   - Columnas nuevas: imagen_url, imagen_path, codigo_barras, codigo_barras_interno
--   - UNIQUE parcial por (empresa_id, codigo_barras)
--   - Indices pg_trgm para busqueda por palabra parcial (nombre, sku, codigo_barras)
--   - Tabla auxiliar productos_codigo_secuencia(empresa_id, last_value) para
--     generar codigos internos atomicamente sin race conditions.
--
-- Reglas:
--   - IF NOT EXISTS en TODAS las sentencias.
--   - NO toca datos existentes.
--   - NO genera codigos para productos preexistentes (solo nuevos via app).
--   - Itera schemas donde existe la tabla `productos` (zentra_erp, public, erp_%, er_*).
-- =============================================================================

-- 0) Extension pg_trgm (publica, una sola vez)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1) Columnas nuevas + UNIQUE parcial + GIN trigram en cada schema con `productos`
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
    RAISE NOTICE '[productos imagen/codbar] procesando schema: %', r.sch;

    -- Columnas aditivas
    EXECUTE format(
      'ALTER TABLE %I.productos
         ADD COLUMN IF NOT EXISTS imagen_url text,
         ADD COLUMN IF NOT EXISTS imagen_path text,
         ADD COLUMN IF NOT EXISTS codigo_barras text,
         ADD COLUMN IF NOT EXISTS codigo_barras_interno boolean NOT NULL DEFAULT false',
      r.sch
    );

    -- UNIQUE parcial: solo cuando codigo_barras IS NOT NULL
    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_productos_codigo_barras
         ON %I.productos (empresa_id, codigo_barras)
         WHERE codigo_barras IS NOT NULL',
      r.sch
    );

    -- Indices trigram para busqueda con %q%
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_productos_nombre_trgm
         ON %I.productos USING gin (nombre gin_trgm_ops)',
      r.sch
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_productos_sku_trgm
         ON %I.productos USING gin (sku gin_trgm_ops)',
      r.sch
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_productos_codigo_barras_trgm
         ON %I.productos USING gin (codigo_barras gin_trgm_ops)',
      r.sch
    );

    -- Tabla secuencia atomica por empresa para codigo interno autogenerado
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I.productos_codigo_secuencia (
         empresa_id uuid PRIMARY KEY,
         last_value bigint NOT NULL DEFAULT 0,
         updated_at timestamptz NOT NULL DEFAULT now()
       )',
      r.sch
    );

    -- Funcion atomica: UPSERT incrementa last_value bajo lock de fila
    -- (ON CONFLICT DO UPDATE) y devuelve el valor incrementado.
    EXECUTE format(
      $f$
      CREATE OR REPLACE FUNCTION %I.incrementar_secuencia_producto(p_empresa_id uuid)
      RETURNS bigint
      LANGUAGE plpgsql
      AS $body$
      DECLARE v bigint;
      BEGIN
        INSERT INTO %I.productos_codigo_secuencia (empresa_id, last_value)
        VALUES (p_empresa_id, 1)
        ON CONFLICT (empresa_id) DO UPDATE
          SET last_value = %I.productos_codigo_secuencia.last_value + 1,
              updated_at = now()
        RETURNING last_value INTO v;
        RETURN v;
      END;
      $body$;
      $f$,
      r.sch, r.sch, r.sch
    );
  END LOOP;
END;
$$;
