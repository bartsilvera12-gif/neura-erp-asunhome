-- =============================================================================
-- SIFEN — cancelación lógica de DE + plazo configurable + marca de aprobación SET
-- =============================================================================

-- Plazo desde sifen_aprobado_at (horas); default 48; sin hardcode en app (lee columna).
ALTER TABLE zentra_erp.empresa_sifen_config
  ADD COLUMN IF NOT EXISTS sifen_plazo_cancelacion_horas integer NOT NULL DEFAULT 48
    CHECK (sifen_plazo_cancelacion_horas >= 1 AND sifen_plazo_cancelacion_horas <= 8760);

COMMENT ON COLUMN zentra_erp.empresa_sifen_config.sifen_plazo_cancelacion_horas IS
  'Horas desde sifen_aprobado_at durante las cuales el DE puede anularse en ERP (sin pagos).';

ALTER TABLE zentra_erp.factura_electronica
  ADD COLUMN IF NOT EXISTS sifen_aprobado_at timestamptz,
  ADD COLUMN IF NOT EXISTS sifen_cancelado_at timestamptz,
  ADD COLUMN IF NOT EXISTS sifen_cancelacion_motivo text;

COMMENT ON COLUMN zentra_erp.factura_electronica.sifen_aprobado_at IS
  'Momento en que SET confirmó aprobación (consulta-lote); base del plazo de cancelación.';
COMMENT ON COLUMN zentra_erp.factura_electronica.sifen_cancelado_at IS
  'Anulación lógica del DE en ERP (no borra fila ni documento físico).';
COMMENT ON COLUMN zentra_erp.factura_electronica.sifen_cancelacion_motivo IS
  'Motivo declarado al cancelar en ERP.';

-- Aprobados existentes sin marca: aproximación conservadora (mejor que NULL).
UPDATE zentra_erp.factura_electronica
SET sifen_aprobado_at = COALESCE(sifen_aprobado_at, updated_at)
WHERE estado_sifen = 'aprobado'
  AND sifen_aprobado_at IS NULL;

ALTER TABLE zentra_erp.factura_electronica
  DROP CONSTRAINT IF EXISTS factura_electronica_estado_sifen_check;

ALTER TABLE zentra_erp.factura_electronica
  ADD CONSTRAINT factura_electronica_estado_sifen_check
  CHECK (estado_sifen IN (
    'borrador',
    'generado',
    'firmado',
    'enviado',
    'aprobado',
    'rechazado',
    'error_envio',
    'cancelado'
  ));

ALTER TABLE zentra_erp.factura_electronica_evento
  DROP CONSTRAINT IF EXISTS factura_electronica_evento_tipo_check;

ALTER TABLE zentra_erp.factura_electronica_evento
  ADD CONSTRAINT factura_electronica_evento_tipo_check
  CHECK (tipo IN ('generacion', 'envio', 'respuesta', 'error', 'firma', 'cancelacion'));

NOTIFY pgrst, 'reload schema';
