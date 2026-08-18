-- Trazabilidad validación datos bancarios OCR vs config del canal + estado datos_bancarios_incoherentes

ALTER TABLE public.chat_comprobante_validaciones
  ADD COLUMN IF NOT EXISTS bank_val_titular_esperado text,
  ADD COLUMN IF NOT EXISTS bank_val_cuenta_esperada text,
  ADD COLUMN IF NOT EXISTS bank_val_alias_esperado text,
  ADD COLUMN IF NOT EXISTS bank_val_titular_ocr text,
  ADD COLUMN IF NOT EXISTS bank_val_cuenta_ocr text,
  ADD COLUMN IF NOT EXISTS bank_val_alias_ocr text,
  ADD COLUMN IF NOT EXISTS bank_val_coincidencias integer,
  ADD COLUMN IF NOT EXISTS bank_val_min_requeridas integer,
  ADD COLUMN IF NOT EXISTS bank_val_status text;

COMMENT ON COLUMN public.chat_comprobante_validaciones.bank_val_status IS
  'omitido_config | omitido_sin_esperado | omitido_sin_ocr_bancario | coincide | discrepancia';

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
    'monto_incoherente',
    'datos_bancarios_incoherentes'
  ));
