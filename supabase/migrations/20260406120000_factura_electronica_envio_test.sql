-- =============================================================================
-- SIFEN TEST: estado error_envio + trazas recibe-lote (dProtConsLote, JSON)
-- =============================================================================

ALTER TABLE public.factura_electronica
  ADD COLUMN IF NOT EXISTS sifen_d_prot_cons_lote text,
  ADD COLUMN IF NOT EXISTS sifen_ultima_respuesta_recibe_lote jsonb;

COMMENT ON COLUMN public.factura_electronica.sifen_d_prot_cons_lote IS
  'Valor dProtConsLote devuelto por SET al aceptar el lote (código 0300).';

COMMENT ON COLUMN public.factura_electronica.sifen_ultima_respuesta_recibe_lote IS
  'Última respuesta parseada de recibe-lote (SOAP): códigos, cuerpo crudo, httpStatus.';

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
    'rechazado',
    'error_envio'
  ));
