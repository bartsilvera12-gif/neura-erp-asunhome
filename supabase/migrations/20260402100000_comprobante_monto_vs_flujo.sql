-- Validación monto comprobante vs monto elegido en flujo (auditoría + estado monto_incoherente)

ALTER TABLE public.chat_comprobante_validaciones
  ADD COLUMN IF NOT EXISTS monto_validacion_esperado_gs bigint,
  ADD COLUMN IF NOT EXISTS monto_validacion_ocr_gs bigint,
  ADD COLUMN IF NOT EXISTS monto_validacion_diferencia_gs bigint,
  ADD COLUMN IF NOT EXISTS monto_validacion_status text;

COMMENT ON COLUMN public.chat_comprobante_validaciones.monto_validacion_esperado_gs IS
  'Monto esperado (GS) desde chat_flow_data del flow_session_id, si aplica validación.';
COMMENT ON COLUMN public.chat_comprobante_validaciones.monto_validacion_ocr_gs IS
  'Monto interpretado del OCR (GS).';
COMMENT ON COLUMN public.chat_comprobante_validaciones.monto_validacion_diferencia_gs IS
  'abs(esperado - ocr) al momento de validar.';
COMMENT ON COLUMN public.chat_comprobante_validaciones.monto_validacion_status IS
  'omitido_config | omitido_sin_esperado | omitido_sin_ocr | coincide | discrepancia | null si no aplica';

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'chat_comprobante_validaciones'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%estado_validacion%'
  LOOP
    EXECUTE format('ALTER TABLE public.chat_comprobante_validaciones DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.chat_comprobante_validaciones
  ADD CONSTRAINT chat_comprobante_validaciones_estado_validacion_check
  CHECK (estado_validacion IN (
    'pendiente',
    'valido',
    'duplicado_hash',
    'duplicado_ocr',
    'revision_manual',
    'ocr_error',
    'monto_incoherente'
  ));
