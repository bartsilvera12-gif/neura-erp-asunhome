-- ============================================================================
-- Migracion: Ordenes de Compra (OC) + factura en Compras.
-- Schema: ferreteriarepublica
-- Fecha: 2026-07-05
--
-- Separa el flujo: primero se genera una ORDEN DE COMPRA al proveedor
-- (productos, cantidades y costos pactados, SIN numero de factura y SIN
-- impacto en stock). Cuando llega la factura del proveedor, la OC se
-- "recibe": se registra la COMPRA real (con numero de factura + timbrado) y
-- recien ahi impacta el inventario.
--
-- Modelo PLANO (igual que `compras`): N filas por OC que comparten `numero_oc`.
-- Idempotente, no destructiva.
-- ============================================================================

SET search_path TO ferreteriarepublica, public;

-- ---------------------------------------------------------------------------
-- 1) Tabla ordenes_compra (una fila por producto, agrupadas por numero_oc)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ferreteriarepublica.ordenes_compra (
  id                        uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  empresa_id                uuid NOT NULL,
  numero_oc                 text NOT NULL,           -- OC-000001 (agrupador; NO unico por fila)

  proveedor_id              uuid NOT NULL,
  proveedor_nombre          text NOT NULL DEFAULT '',

  producto_id               uuid NOT NULL,
  producto_nombre           text NOT NULL DEFAULT '',

  cantidad                  numeric NOT NULL DEFAULT 0,

  moneda                    text NOT NULL DEFAULT 'PYG' CHECK (moneda IN ('PYG', 'USD')),
  tipo_cambio               numeric NOT NULL DEFAULT 1,
  costo_unitario_original   numeric NOT NULL DEFAULT 0,   -- en la moneda elegida
  costo_unitario            numeric NOT NULL DEFAULT 0,   -- siempre PYG

  iva_tipo                  text NOT NULL DEFAULT '10' CHECK (iva_tipo IN ('exenta', '5', '10')),
  subtotal                  numeric NOT NULL DEFAULT 0,
  monto_iva                 numeric NOT NULL DEFAULT 0,
  total                     numeric NOT NULL DEFAULT 0,

  precio_venta              numeric NOT NULL DEFAULT 0,   -- venta sugerida (pactada)
  margen_venta              numeric NULL,

  -- Condiciones pactadas (informativas en la OC; se confirman al recibir).
  tipo_pago                 text NOT NULL DEFAULT 'contado' CHECK (tipo_pago IN ('contado', 'credito')),
  plazo_dias                integer NULL,

  -- Estado del turno de la OC (mismo valor en todas las filas del numero_oc).
  estado                    text NOT NULL DEFAULT 'abierta'
                            CHECK (estado IN ('abierta', 'recibida', 'cancelada')),
  observacion               text NULL,

  -- Trazabilidad de la recepcion / cancelacion.
  compra_numero_control     text NULL,                -- COMP-XXXXXX generado al recibir
  recibida_at               timestamp with time zone NULL,
  cancelada_at              timestamp with time zone NULL,
  cancelada_motivo          text NULL,

  fecha                     timestamp with time zone NOT NULL DEFAULT now(),
  created_at                timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                timestamp with time zone NOT NULL DEFAULT now(),
  created_by                uuid NULL,
  usuario_nombre            text NULL
);

CREATE INDEX IF NOT EXISTS idx_ordenes_compra_empresa   ON ferreteriarepublica.ordenes_compra (empresa_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_numero    ON ferreteriarepublica.ordenes_compra (empresa_id, numero_oc);
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_proveedor ON ferreteriarepublica.ordenes_compra (proveedor_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_estado    ON ferreteriarepublica.ordenes_compra (empresa_id, estado);
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_fecha     ON ferreteriarepublica.ordenes_compra (fecha);

-- ---------------------------------------------------------------------------
-- 2) Compras: numero de factura del proveedor + link a la OC de origen.
--    Ambas nullable: la compra directa (sin OC) puede o no tener factura;
--    la app exige numero_factura en el alta nueva, pero no rompemos historicos.
-- ---------------------------------------------------------------------------
ALTER TABLE ferreteriarepublica.compras
  ADD COLUMN IF NOT EXISTS numero_factura       text NULL,
  ADD COLUMN IF NOT EXISTS orden_compra_numero  text NULL;

CREATE INDEX IF NOT EXISTS idx_compras_orden_compra
  ON ferreteriarepublica.compras (empresa_id, orden_compra_numero);
