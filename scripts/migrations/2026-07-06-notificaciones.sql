-- ============================================================================
-- Migracion: Notificaciones (campanita) — alertas de stock bajo para clase A.
-- Schema: ferreteriarepublica
-- Fecha: 2026-07-06
--
-- Tabla generica de notificaciones por empresa. Primer uso: aviso urgente
-- cuando un producto clase A (alta rotacion) llega a stock_actual <= stock_minimo + 10.
-- Idempotente, no destructiva.
-- ============================================================================

SET search_path TO ferreteriarepublica, public;

CREATE TABLE IF NOT EXISTS ferreteriarepublica.notificaciones (
  id            uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  empresa_id    uuid NOT NULL,
  tipo          text NOT NULL,                 -- 'stock_bajo_a', etc.
  titulo        text NOT NULL,
  mensaje       text NOT NULL,
  producto_id   uuid NULL,                     -- para enlazar al detalle
  url           text NULL,                     -- destino al hacer click
  leida         boolean NOT NULL DEFAULT false,
  created_at    timestamp with time zone NOT NULL DEFAULT now(),
  updated_at    timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notificaciones_empresa
  ON ferreteriarepublica.notificaciones (empresa_id, leida, created_at DESC);

-- Dedupe: una sola notificacion NO leida por (empresa, producto, tipo).
-- Al leerla, se puede volver a generar otra si el stock sigue bajo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notificaciones_activa
  ON ferreteriarepublica.notificaciones (empresa_id, producto_id, tipo)
  WHERE leida = false AND producto_id IS NOT NULL;
