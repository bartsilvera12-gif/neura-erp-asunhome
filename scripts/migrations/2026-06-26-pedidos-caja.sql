-- ============================================================================
-- Migracion: pedidos_caja (modulo Consulta).
-- Schema: ferreteriarepublica
-- Fecha: 2026-06-26
--
-- Idempotente. No destructiva.
--
-- Modelo: el vendedor arma un pedido en /consulta y lo "envia a caja". El
-- cajero lo ve en /ventas/nueva, lo precarga y cobra. Una sola caja por
-- empresa (decision tomada: no usamos caja_destino_numero como Chaco).
-- ============================================================================

SET search_path TO ferreteriarepublica, public;

CREATE TABLE IF NOT EXISTS ferreteriarepublica.pedidos_caja (
  id                  uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  empresa_id          uuid NOT NULL,
  -- Etiqueta visible para el cajero (auto-generada del cliente o cantidad).
  titulo              text NOT NULL,
  -- Cliente opcional (FK debil — si el cliente se borra el pedido sobrevive
  -- con el snapshot de nombre/telefono).
  cliente_id          uuid NULL,
  cliente_nombre      text NULL,
  cliente_telefono    text NULL,
  observacion         text NULL,
  -- Lineas del pedido en JSONB con snapshot completo: producto_id,
  -- producto_nombre, sku, cantidad, precio_venta, tipo_precio, +opcional
  -- presentacion_id/nombre/cantidad_base.
  items               jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_estimado      numeric NOT NULL DEFAULT 0,
  estado              text NOT NULL DEFAULT 'pendiente'
                      CHECK (estado IN ('pendiente','facturado','cancelado')),
  -- Auditoria de quien lo armo.
  armado_por_id       uuid NULL,
  armado_por_email    text NULL,
  -- Link a la venta cuando se factura.
  venta_id            uuid NULL,
  venta_numero        text NULL,
  facturado_at        timestamp with time zone NULL,
  -- Auditoria de cancelacion.
  cancelado_por_id    uuid NULL,
  cancelado_motivo    text NULL,
  cancelado_at        timestamp with time zone NULL,
  created_at          timestamp with time zone NOT NULL DEFAULT now(),
  updated_at          timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pedidos_caja_empresa_estado_idx
  ON ferreteriarepublica.pedidos_caja (empresa_id, estado, created_at DESC);
CREATE INDEX IF NOT EXISTS pedidos_caja_armado_por_idx
  ON ferreteriarepublica.pedidos_caja (empresa_id, armado_por_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pedidos_caja_venta_idx
  ON ferreteriarepublica.pedidos_caja (empresa_id, venta_id);

-- Trigger touch updated_at.
CREATE OR REPLACE FUNCTION ferreteriarepublica.touch_pedidos_caja_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pedidos_caja_touch ON ferreteriarepublica.pedidos_caja;
CREATE TRIGGER pedidos_caja_touch
  BEFORE UPDATE ON ferreteriarepublica.pedidos_caja
  FOR EACH ROW
  EXECUTE FUNCTION ferreteriarepublica.touch_pedidos_caja_updated_at();
