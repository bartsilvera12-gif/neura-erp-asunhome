-- ============================================================================
-- Migracion: extender caja_movimientos para el modulo 'Otros ingresos'.
-- Schema: ferreteriarepublica
-- Fecha: 2026-06-26
--
-- Idempotente. No destructiva. NO crea tabla nueva: extiende
-- caja_movimientos con columnas de anulacion soft + auditoria.
--
-- El modulo 'Otros ingresos' = vista filtrada de caja_movimientos donde
-- tipo='ingreso' y anulado_at IS NULL. Suma a caja por el mismo computeResumen
-- existente. Cero impacto en inventario.
-- ============================================================================

SET search_path TO ferreteriarepublica, public;

ALTER TABLE ferreteriarepublica.caja_movimientos
  ADD COLUMN IF NOT EXISTS anulado_at      timestamp with time zone NULL,
  ADD COLUMN IF NOT EXISTS anulado_por_id  uuid NULL,
  ADD COLUMN IF NOT EXISTS anulado_motivo  text NULL,
  ADD COLUMN IF NOT EXISTS usuario_email   text NULL;

COMMENT ON COLUMN ferreteriarepublica.caja_movimientos.anulado_at IS
  'Cuando se anulo el movimiento. NULL = activo. Anulados NO suman a caja.';
COMMENT ON COLUMN ferreteriarepublica.caja_movimientos.anulado_por_id IS
  'Usuario que ejecuto la anulacion (auditoria).';
COMMENT ON COLUMN ferreteriarepublica.caja_movimientos.anulado_motivo IS
  'Texto libre con el motivo de la anulacion.';
COMMENT ON COLUMN ferreteriarepublica.caja_movimientos.usuario_email IS
  'Email snapshot del usuario que registro (para listados sin JOIN).';

-- Indice para listados filtrados por tipo/estado/fecha (sin scan completo).
CREATE INDEX IF NOT EXISTS caja_movimientos_tipo_estado_fecha_idx
  ON ferreteriarepublica.caja_movimientos
    (empresa_id, tipo, (anulado_at IS NULL), created_at DESC);

-- Verificacion
DO $$
DECLARE
  total bigint;
  ingresos bigint;
BEGIN
  SELECT COUNT(*), COUNT(*) FILTER (WHERE tipo='ingreso')
    INTO total, ingresos
    FROM ferreteriarepublica.caja_movimientos;
  RAISE NOTICE 'caja_movimientos -> total: %, ingresos: %', total, ingresos;
END $$;
