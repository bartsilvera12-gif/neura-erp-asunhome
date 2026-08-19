-- ============================================================================
-- Migracion: Cajas (turnos abrir/cerrar) + movimientos manuales.
-- Schema: ferreteriarepublica
-- Fecha: 2026-06-26
--
-- Idempotente, no destructiva. Adaptado para UNA sola caja por empresa
-- (sin columna numero_caja: el indice unique parcial garantiza que solo
-- haya una caja abierta a la vez).
-- ============================================================================

SET search_path TO ferreteriarepublica, public;

-- ---------------------------------------------------------------------------
-- 1) Tabla cajas (turnos)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ferreteriarepublica.cajas (
  id                          uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  empresa_id                  uuid NOT NULL,
  estado                      text NOT NULL DEFAULT 'abierta'
                              CHECK (estado IN ('abierta', 'cerrada')),
  abierta_por                 uuid NULL,
  cerrada_por                 uuid NULL,
  fecha_apertura              timestamp with time zone NOT NULL DEFAULT now(),
  fecha_cierre                timestamp with time zone NULL,
  monto_apertura              numeric NOT NULL DEFAULT 0,
  -- Al cerrar: lo que efectivamente conto el cajero.
  monto_cierre_contado        numeric NULL,
  -- Al cerrar: lo que el sistema calculo que deberia haber (verdad del arqueo).
  monto_esperado_efectivo     numeric NULL,
  -- contado - esperado (positivo = sobra, negativo = falta).
  diferencia                  numeric NULL,
  observacion_apertura        text NULL,
  observacion_cierre          text NULL,
  created_at                  timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                  timestamp with time zone NOT NULL DEFAULT now()
);

-- Indice unique PARCIAL: a lo sumo UNA caja abierta por empresa. Es la
-- garantia hard que previene "abrir dos veces" en una misma empresa.
CREATE UNIQUE INDEX IF NOT EXISTS cajas_unica_abierta_por_empresa
  ON ferreteriarepublica.cajas (empresa_id)
  WHERE estado = 'abierta';

CREATE INDEX IF NOT EXISTS cajas_empresa_fecha_idx
  ON ferreteriarepublica.cajas (empresa_id, fecha_apertura DESC);

-- ---------------------------------------------------------------------------
-- 2) Tabla caja_movimientos (ingresos / egresos / retiros / ajustes manuales)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ferreteriarepublica.caja_movimientos (
  id              uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  empresa_id      uuid NOT NULL,
  caja_id         uuid NOT NULL,
  tipo            text NOT NULL CHECK (tipo IN ('ingreso','egreso','retiro','ajuste')),
  concepto        text NOT NULL,
  monto           numeric NOT NULL,
  medio_pago      text NOT NULL DEFAULT 'efectivo'
                  CHECK (medio_pago IN ('efectivo','tarjeta','transferencia','otro')),
  usuario_id      uuid NULL,
  observacion     text NULL,
  created_at      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT caja_movimientos_caja_fk
    FOREIGN KEY (caja_id) REFERENCES ferreteriarepublica.cajas(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS caja_movimientos_caja_idx
  ON ferreteriarepublica.caja_movimientos (caja_id, created_at);
CREATE INDEX IF NOT EXISTS caja_movimientos_empresa_idx
  ON ferreteriarepublica.caja_movimientos (empresa_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3) ventas.caja_id (nullable, compat con ventas existentes)
-- ---------------------------------------------------------------------------
-- Si la columna ya existe (por migration previa), no hace nada.
ALTER TABLE ferreteriarepublica.ventas
  ADD COLUMN IF NOT EXISTS caja_id uuid NULL;

COMMENT ON COLUMN ferreteriarepublica.ventas.caja_id IS
  'FK a cajas. NULL si la venta se hizo sin caja abierta (modo legacy o pre-funcionalidad). El cierre de caja agrupa ventas por este campo, no por fecha calendario.';

CREATE INDEX IF NOT EXISTS ventas_caja_idx
  ON ferreteriarepublica.ventas (empresa_id, caja_id);

-- ---------------------------------------------------------------------------
-- 4) Triggers touch updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ferreteriarepublica.touch_cajas_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cajas_touch ON ferreteriarepublica.cajas;
CREATE TRIGGER cajas_touch
  BEFORE UPDATE ON ferreteriarepublica.cajas
  FOR EACH ROW
  EXECUTE FUNCTION ferreteriarepublica.touch_cajas_updated_at();
