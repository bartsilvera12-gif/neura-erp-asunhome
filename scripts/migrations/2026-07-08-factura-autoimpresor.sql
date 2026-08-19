-- =============================================================================
-- Factura autoimpresor (formato TICKET): registro fiscal por venta.
--
-- Guarda el numero fiscal correlativo (EST-PEXP-0000001) asignado a cada venta
-- cuando el modo de facturacion es 'autoimpresor'. El ticket de la venta pasa a
-- ser la factura legal: mismo formato de ticket + timbrado + numero + liquidacion
-- de IVA. El correlativo se toma/incrementa de empresa_autoimpresor_config
-- (numero_actual) de forma atomica al emitir.
--
-- Single-schema (ferreteriarepublica). Aditiva e idempotente. No toca SIFEN.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ferreteriarepublica.factura_autoimpresor (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id                uuid NOT NULL,
  venta_id                  uuid NOT NULL
                              REFERENCES ferreteriarepublica.ventas(id) ON DELETE CASCADE,
  numero_secuencia          integer NOT NULL,
  numero_completo           text NOT NULL,          -- '001-002-0000001'
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
  ON ferreteriarepublica.factura_autoimpresor (empresa_id, venta_id);

CREATE UNIQUE INDEX IF NOT EXISTS factura_autoimpresor_numero_uq
  ON ferreteriarepublica.factura_autoimpresor
     (empresa_id, timbrado_numero, establecimiento_codigo, punto_expedicion_codigo, numero_secuencia);
