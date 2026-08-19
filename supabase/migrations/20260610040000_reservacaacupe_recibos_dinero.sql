-- Recibos de dinero (comprobante interno NO fiscal). Solo schema reservacaacupe. Idempotente.
-- No toca stock, deuda, ventas, cobros, SIFEN ni otros schemas.

CREATE TABLE IF NOT EXISTS reservacaacupe.recibos_dinero (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            uuid NOT NULL,
  numero_recibo         text NOT NULL,
  cliente_id            uuid,
  cliente_nombre        text NOT NULL,
  cliente_documento     text,
  origen                text NOT NULL DEFAULT 'manual',
  venta_id              uuid,
  cuenta_por_cobrar_id  uuid,
  cobro_cliente_id      uuid,
  fecha                 timestamptz NOT NULL DEFAULT now(),
  moneda                text NOT NULL DEFAULT 'PYG',
  monto                 numeric NOT NULL DEFAULT 0,
  metodo_pago           text,
  entidad_bancaria_id   uuid,
  referencia            text,
  concepto              text,
  observaciones         text,
  usuario_id            uuid,
  usuario_nombre        text,
  anulado               boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE reservacaacupe.recibos_dinero
  DROP CONSTRAINT IF EXISTS recibos_dinero_origen_check;
ALTER TABLE reservacaacupe.recibos_dinero
  ADD CONSTRAINT recibos_dinero_origen_check
  CHECK (origen = ANY (ARRAY['venta_contado'::text, 'cobro_cxc'::text, 'manual'::text]));

-- Numeración única por empresa (REC-XXXXXX).
CREATE UNIQUE INDEX IF NOT EXISTS uq_recibos_empresa_numero
  ON reservacaacupe.recibos_dinero (empresa_id, numero_recibo);

-- Anti-duplicado: un recibo por cobro de CxC.
CREATE UNIQUE INDEX IF NOT EXISTS uq_recibos_cobro
  ON reservacaacupe.recibos_dinero (cobro_cliente_id)
  WHERE cobro_cliente_id IS NOT NULL;

-- Anti-duplicado: un recibo por venta contado.
CREATE UNIQUE INDEX IF NOT EXISTS uq_recibos_venta_contado
  ON reservacaacupe.recibos_dinero (venta_id)
  WHERE origen = 'venta_contado' AND venta_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_recibos_empresa_fecha
  ON reservacaacupe.recibos_dinero (empresa_id, fecha DESC);
