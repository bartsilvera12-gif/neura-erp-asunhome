-- Aprobación manual inbox: estados + auditoría (todos los schemas con chat_comprobante_validaciones).

DO $$
DECLARE
  sch text;
  con record;
BEGIN
  FOR sch IN
    SELECT DISTINCT n.nspname::text
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'chat_comprobante_validaciones'
      AND c.relkind = 'r'
  LOOP
    FOR con IN
      SELECT c.conname::text
      FROM pg_constraint c
      JOIN pg_class cf ON cf.oid = c.conrelid
      JOIN pg_namespace tn ON tn.oid = cf.relnamespace
      WHERE tn.nspname = sch
        AND cf.relname = 'chat_comprobante_validaciones'
        AND c.contype = 'c'
        AND pg_get_constraintdef(c.oid) LIKE '%estado_validacion%'
    LOOP
      EXECUTE format('ALTER TABLE %I.chat_comprobante_validaciones DROP CONSTRAINT IF EXISTS %I', sch, con.conname);
    END LOOP;

    EXECUTE format(
      'ALTER TABLE %I.chat_comprobante_validaciones
       ADD CONSTRAINT chat_comprobante_validaciones_estado_validacion_check
       CHECK (estado_validacion IN (
         ''pendiente'',
         ''valido'',
         ''duplicado_hash'',
         ''duplicado_ocr'',
         ''revision_manual'',
         ''ocr_error'',
         ''monto_incoherente'',
         ''datos_bancarios_incoherentes'',
         ''aprobado_manual'',
         ''rechazado_manual''
       ))',
      sch
    );

    EXECUTE format(
      'ALTER TABLE %I.chat_comprobante_validaciones
         ADD COLUMN IF NOT EXISTS manual_approval_usuario_id uuid,
         ADD COLUMN IF NOT EXISTS manual_approval_at timestamptz,
         ADD COLUMN IF NOT EXISTS manual_approval_source text,
         ADD COLUMN IF NOT EXISTS manual_approval_note text,
         ADD COLUMN IF NOT EXISTS previous_estado_validacion text,
         ADD COLUMN IF NOT EXISTS previous_motivo_validacion text',
      sch
    );

    RAISE NOTICE 'comprobante manual approval cols: %', sch;
  END LOOP;
END $$;
