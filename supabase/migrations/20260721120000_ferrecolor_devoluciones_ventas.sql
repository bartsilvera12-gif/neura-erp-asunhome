-- ============================================================================
-- Devoluciones de ventas. ADITIVA E IDEMPOTENTE. Solo schema ferrecolor.
-- No modifica ni borra ventas originales. Convive con notas de credito / SIFEN.
-- ============================================================================

-- ── 1) Cabecera de devolucion ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ferrecolor.devoluciones_venta (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id              uuid NOT NULL,
  numero_devolucion       text NOT NULL,
  venta_id                uuid NOT NULL REFERENCES ferrecolor.ventas(id),
  venta_numero_control    text,
  venta_fecha             timestamptz,
  cliente_id              uuid,
  cliente_nombre          text,
  tipo                    text NOT NULL DEFAULT 'parcial',
  resolucion              text NOT NULL DEFAULT 'reembolso',
  estado                  text NOT NULL DEFAULT 'confirmada',
  motivo                  text,
  total_devuelto          numeric NOT NULL DEFAULT 0,
  total_entregado         numeric NOT NULL DEFAULT 0,
  diferencia              numeric NOT NULL DEFAULT 0,
  metodo_reembolso        text,
  caja_id                 uuid,
  caja_movimiento_id      uuid,
  requiere_nota_credito   boolean NOT NULL DEFAULT false,
  idempotency_key         text,
  created_by              uuid,
  usuario_nombre          text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  anulada_at              timestamptz,
  anulada_por             uuid,
  anulada_motivo          text,
  anulada_caja_movimiento_id uuid
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ferrecolor.devoluciones_venta'::regclass AND conname='devoluciones_venta_tipo_check') THEN
    ALTER TABLE ferrecolor.devoluciones_venta ADD CONSTRAINT devoluciones_venta_tipo_check CHECK (tipo IN ('total','parcial'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ferrecolor.devoluciones_venta'::regclass AND conname='devoluciones_venta_resolucion_check') THEN
    ALTER TABLE ferrecolor.devoluciones_venta ADD CONSTRAINT devoluciones_venta_resolucion_check CHECK (resolucion IN ('reembolso','cambio'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ferrecolor.devoluciones_venta'::regclass AND conname='devoluciones_venta_estado_check') THEN
    ALTER TABLE ferrecolor.devoluciones_venta ADD CONSTRAINT devoluciones_venta_estado_check CHECK (estado IN ('confirmada','anulada'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ferrecolor.devoluciones_venta'::regclass AND conname='devoluciones_venta_metodo_check') THEN
    ALTER TABLE ferrecolor.devoluciones_venta ADD CONSTRAINT devoluciones_venta_metodo_check CHECK (metodo_reembolso IS NULL OR metodo_reembolso IN ('efectivo','tarjeta','transferencia'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS devoluciones_venta_numero_uidx
  ON ferrecolor.devoluciones_venta (empresa_id, numero_devolucion);
-- Idempotencia: una misma confirmacion (doble clic / reintento) no duplica.
CREATE UNIQUE INDEX IF NOT EXISTS devoluciones_venta_idem_uidx
  ON ferrecolor.devoluciones_venta (empresa_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS devoluciones_venta_venta_idx
  ON ferrecolor.devoluciones_venta (empresa_id, venta_id);
CREATE INDEX IF NOT EXISTS devoluciones_venta_fecha_idx
  ON ferrecolor.devoluciones_venta (empresa_id, created_at DESC);

-- ── 2) Items devueltos (snapshot de la linea original) ──────────────────────
CREATE TABLE IF NOT EXISTS ferrecolor.devoluciones_venta_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        uuid NOT NULL,
  devolucion_id     uuid NOT NULL REFERENCES ferrecolor.devoluciones_venta(id) ON DELETE CASCADE,
  venta_item_id     uuid NOT NULL REFERENCES ferrecolor.ventas_items(id),
  producto_id       uuid NOT NULL,
  producto_nombre   text NOT NULL,
  sku               text,
  cantidad_vendida  numeric NOT NULL,
  cantidad_devuelta numeric NOT NULL,
  precio_unitario   numeric NOT NULL,
  tipo_iva          text NOT NULL,
  monto_iva         numeric NOT NULL DEFAULT 0,
  total_devuelto    numeric NOT NULL DEFAULT 0,
  condicion         text NOT NULL DEFAULT 'buen_estado',
  reintegra_stock   boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ferrecolor.devoluciones_venta_items'::regclass AND conname='devoluciones_venta_items_condicion_check') THEN
    ALTER TABLE ferrecolor.devoluciones_venta_items ADD CONSTRAINT devoluciones_venta_items_condicion_check CHECK (condicion IN ('buen_estado','danado'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ferrecolor.devoluciones_venta_items'::regclass AND conname='devoluciones_venta_items_cant_check') THEN
    ALTER TABLE ferrecolor.devoluciones_venta_items ADD CONSTRAINT devoluciones_venta_items_cant_check CHECK (cantidad_devuelta > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS devoluciones_venta_items_dev_idx
  ON ferrecolor.devoluciones_venta_items (empresa_id, devolucion_id);
CREATE INDEX IF NOT EXISTS devoluciones_venta_items_vitem_idx
  ON ferrecolor.devoluciones_venta_items (empresa_id, venta_item_id);

-- ── 3) Productos entregados como cambio ────────────────────────────────────
CREATE TABLE IF NOT EXISTS ferrecolor.devoluciones_venta_cambios (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL,
  devolucion_id   uuid NOT NULL REFERENCES ferrecolor.devoluciones_venta(id) ON DELETE CASCADE,
  producto_id     uuid NOT NULL,
  producto_nombre text NOT NULL,
  sku             text,
  cantidad        numeric NOT NULL,
  precio_unitario numeric NOT NULL,
  tipo_iva        text NOT NULL DEFAULT '10%',
  monto_iva       numeric NOT NULL DEFAULT 0,
  total           numeric NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ferrecolor.devoluciones_venta_cambios'::regclass AND conname='devoluciones_venta_cambios_cant_check') THEN
    ALTER TABLE ferrecolor.devoluciones_venta_cambios ADD CONSTRAINT devoluciones_venta_cambios_cant_check CHECK (cantidad > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS devoluciones_venta_cambios_dev_idx
  ON ferrecolor.devoluciones_venta_cambios (empresa_id, devolucion_id);

-- ── 4) Estados de venta compatibles ────────────────────────────────────────
-- Amplia el CHECK existente sin perder los valores previos.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ferrecolor.ventas'::regclass AND conname='ventas_estado_check') THEN
    ALTER TABLE ferrecolor.ventas DROP CONSTRAINT ventas_estado_check;
  END IF;
  ALTER TABLE ferrecolor.ventas ADD CONSTRAINT ventas_estado_check
    CHECK (estado IN ('pendiente','completada','anulada','parcialmente_devuelta','devuelta_total'));
END $$;

-- ── 5) Origen de movimiento de inventario: devolucion_venta ────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ferrecolor.movimientos_inventario'::regclass AND conname='movimientos_inventario_origen_check') THEN
    ALTER TABLE ferrecolor.movimientos_inventario DROP CONSTRAINT movimientos_inventario_origen_check;
  END IF;
  ALTER TABLE ferrecolor.movimientos_inventario ADD CONSTRAINT movimientos_inventario_origen_check
    CHECK (origen IN ('compra','venta','ajuste_manual','inventario_inicial','produccion','devolucion_venta'));
END $$;

-- ── 6) Vinculos de trazabilidad (aditivos, nullable) ───────────────────────
ALTER TABLE ferrecolor.movimientos_inventario
  ADD COLUMN IF NOT EXISTS devolucion_id uuid;
CREATE INDEX IF NOT EXISTS movimientos_inventario_devolucion_idx
  ON ferrecolor.movimientos_inventario (empresa_id, devolucion_id);

ALTER TABLE ferrecolor.caja_movimientos
  ADD COLUMN IF NOT EXISTS devolucion_id uuid;
ALTER TABLE ferrecolor.caja_movimientos
  ADD COLUMN IF NOT EXISTS venta_id uuid;
CREATE INDEX IF NOT EXISTS caja_movimientos_devolucion_idx
  ON ferrecolor.caja_movimientos (empresa_id, devolucion_id);
