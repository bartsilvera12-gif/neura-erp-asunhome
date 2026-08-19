-- ============================================================================
-- Migracion: Multiples cajas / cajas por turno.
-- Schema: ferreteriarepublica
-- Fecha: 2026-07-08
--
-- Permite operar con mas de una caja simultanea (Caja 1, Caja 2, ... N).
-- Cada fila de `cajas` sigue siendo un TURNO (apertura->cierre) con su propio
-- arqueo; se agrega `numero_caja` para identificar el punto de caja y el estado
-- intermedio 'en_cierre' (en conteo: no recibe nuevas ventas ni movimientos,
-- pero todavia no esta cerrada). Idempotente, no destructiva.
-- ============================================================================

SET search_path TO ferreteriarepublica, public;

-- 1) Numero de caja (punto de caja). Los turnos existentes quedan como Caja 1.
ALTER TABLE ferreteriarepublica.cajas
  ADD COLUMN IF NOT EXISTS numero_caja integer NOT NULL DEFAULT 1;

-- 2) Estado: agregar 'en_cierre' (abierta -> en_cierre -> cerrada).
ALTER TABLE ferreteriarepublica.cajas DROP CONSTRAINT IF EXISTS cajas_estado_check;
ALTER TABLE ferreteriarepublica.cajas
  ADD CONSTRAINT cajas_estado_check
  CHECK (estado IN ('abierta', 'en_cierre', 'cerrada'));

-- 3) Multiples cajas activas: se reemplaza "una abierta por empresa" por
--    "una activa (abierta o en_cierre) por (empresa, numero_caja)". Asi Caja 1
--    y Caja 2 pueden estar abiertas a la vez, pero no dos turnos activos sobre
--    el mismo numero de caja.
DROP INDEX IF EXISTS ferreteriarepublica.cajas_unica_abierta_por_empresa;
CREATE UNIQUE INDEX IF NOT EXISTS cajas_activa_por_numero
  ON ferreteriarepublica.cajas (empresa_id, numero_caja)
  WHERE estado IN ('abierta', 'en_cierre');

CREATE INDEX IF NOT EXISTS cajas_empresa_estado_idx
  ON ferreteriarepublica.cajas (empresa_id, estado);
