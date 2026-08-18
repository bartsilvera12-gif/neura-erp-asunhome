-- =============================================================================
-- SIFEN: ruta XML firmado + estado `firmado` + evento tipo `firma`
-- =============================================================================

-- 1) Columna para el XML firmado (bucket `sifen`, ej. {empresa_id}/{factura_id}/documento-firmado.xml)
ALTER TABLE public.factura_electronica
  ADD COLUMN IF NOT EXISTS xml_firmado_path text;

COMMENT ON COLUMN public.factura_electronica.xml_firmado_path IS
  'Ruta en bucket sifen del XML con firma XML-DSig. xml_path conserva el borrador sin firma.';

-- 2) Ampliar estado_sifen (incluye firmado, previo al envío SET)
ALTER TABLE public.factura_electronica
  DROP CONSTRAINT IF EXISTS factura_electronica_estado_sifen_check;

ALTER TABLE public.factura_electronica
  ADD CONSTRAINT factura_electronica_estado_sifen_check
  CHECK (estado_sifen IN (
    'borrador',
    'generado',
    'firmado',
    'enviado',
    'aprobado',
    'rechazado'
  ));

-- 3) Tipo de evento explícito para firma
ALTER TABLE public.factura_electronica_evento
  DROP CONSTRAINT IF EXISTS factura_electronica_evento_tipo_check;

ALTER TABLE public.factura_electronica_evento
  ADD CONSTRAINT factura_electronica_evento_tipo_check
  CHECK (tipo IN ('generacion', 'envio', 'respuesta', 'error', 'firma'));
