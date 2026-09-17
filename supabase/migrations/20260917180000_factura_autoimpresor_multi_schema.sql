-- =============================================================================
-- Factura autoimpresor (multi-schema): registro fiscal por venta.
--
-- Guarda el número fiscal correlativo (EEE-PPP-NNNNNNN, p.ej. 001-001-0004966)
-- asignado a cada venta cuando se emite la factura (preimpresa o autoimpresor
-- ticket). El correlativo se toma/incrementa de empresa_autoimpresor_config
-- (numero_actual) de forma atómica al emitir.
--
-- Aditiva, idempotente, multi-schema (mismo patrón que la migración
-- 20260518230000_facturacion_modo_y_autoimpresor.sql: itera sobre todos los
-- schemas de tenant que ya tienen empresa_sifen_config).
--
-- Suplanta al script single-schema scripts/migrations/2026-07-08-factura-autoimpresor.sql
-- (que sólo creaba la tabla en ferreteriarepublica).
-- =============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'empresa_sifen_config'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
        OR n.nspname = 'asunhome'
        OR n.nspname = 'ferreteriarepublica'
      )
  LOOP
    RAISE NOTICE '[factura_autoimpresor multi-schema] schema=%', r.sch;

    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I.factura_autoimpresor (
        id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id                uuid NOT NULL,
        venta_id                  uuid NOT NULL
                                    REFERENCES %I.ventas(id) ON DELETE CASCADE,
        numero_secuencia          integer NOT NULL,
        numero_completo           text NOT NULL,
        establecimiento_codigo    text NOT NULL,
        punto_expedicion_codigo   text NOT NULL,
        timbrado_numero           text NOT NULL,
        timbrado_inicio_vigencia  date,
        timbrado_fin_vigencia     date,
        condicion                 text NOT NULL DEFAULT 'contado'
                                    CHECK (condicion IN ('contado','credito')),
        gravado_10                numeric NOT NULL DEFAULT 0,
        iva_10                    numeric NOT NULL DEFAULT 0,
        gravado_5                 numeric NOT NULL DEFAULT 0,
        iva_5                     numeric NOT NULL DEFAULT 0,
        exentas                   numeric NOT NULL DEFAULT 0,
        total                     numeric NOT NULL DEFAULT 0,
        emitida_at                timestamptz NOT NULL DEFAULT now(),
        created_at                timestamptz NOT NULL DEFAULT now()
      )
    $f$, r.sch, r.sch);

    EXECUTE format($f$
      CREATE UNIQUE INDEX IF NOT EXISTS factura_autoimpresor_venta_uq
        ON %I.factura_autoimpresor (empresa_id, venta_id)
    $f$, r.sch);

    EXECUTE format($f$
      CREATE UNIQUE INDEX IF NOT EXISTS factura_autoimpresor_numero_uq
        ON %I.factura_autoimpresor
           (empresa_id, timbrado_numero, establecimiento_codigo, punto_expedicion_codigo, numero_secuencia)
    $f$, r.sch);
  END LOOP;
END;
$$;
