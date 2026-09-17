-- =============================================================================
-- Factura autoimpresor (schema asunhome): registro fiscal por venta.
--
-- Guarda el número fiscal correlativo (EEE-PPP-NNNNNNN, p.ej. 001-001-0004966)
-- asignado a cada venta al emitir la factura preimpresa. El correlativo se
-- toma/incrementa de asunhome.empresa_autoimpresor_config (numero_actual) de
-- forma atómica al emitir.
--
-- Ejecutar UNA SOLA VEZ en SQL Editor de Supabase, como postgres. Aditiva e
-- idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS asunhome.factura_autoimpresor (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id                uuid NOT NULL,
  venta_id                  uuid NOT NULL
                              REFERENCES asunhome.ventas(id) ON DELETE CASCADE,
  numero_secuencia          integer NOT NULL,
  numero_completo           text NOT NULL,          -- '001-001-0004966'
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
);

CREATE UNIQUE INDEX IF NOT EXISTS factura_autoimpresor_venta_uq
  ON asunhome.factura_autoimpresor (empresa_id, venta_id);

CREATE UNIQUE INDEX IF NOT EXISTS factura_autoimpresor_numero_uq
  ON asunhome.factura_autoimpresor
     (empresa_id, timbrado_numero, establecimiento_codigo, punto_expedicion_codigo, numero_secuencia);

-- Grants para PostgREST (mismos que las demás tablas del schema).
GRANT SELECT, INSERT, UPDATE, DELETE ON asunhome.factura_autoimpresor TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON asunhome.factura_autoimpresor TO service_role;

-- RLS: mismo patrón que las tablas nuevas del schema (ver PARTE 5 del
-- 00_setup_schema_asunhome.sql): FOR ALL con asunhome.puede_acceder_empresa.
ALTER TABLE asunhome.factura_autoimpresor ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS factura_autoimpresor_by_empresa ON asunhome.factura_autoimpresor;
DROP POLICY IF EXISTS "factura_autoimpresor_select" ON asunhome.factura_autoimpresor;
DROP POLICY IF EXISTS "factura_autoimpresor_insert" ON asunhome.factura_autoimpresor;
DROP POLICY IF EXISTS "factura_autoimpresor_update" ON asunhome.factura_autoimpresor;
DROP POLICY IF EXISTS "factura_autoimpresor_delete" ON asunhome.factura_autoimpresor;
DROP POLICY IF EXISTS "factura_autoimpresor_all" ON asunhome.factura_autoimpresor;

CREATE POLICY "factura_autoimpresor_all" ON asunhome.factura_autoimpresor
  FOR ALL
  TO authenticated
  USING (asunhome.puede_acceder_empresa(empresa_id))
  WITH CHECK (asunhome.puede_acceder_empresa(empresa_id));
