-- =============================================================================
-- SIFEN TEST: última respuesta consulta-lote (jsonb)
-- =============================================================================

ALTER TABLE public.factura_electronica
  ADD COLUMN IF NOT EXISTS sifen_ultima_respuesta_consulta_lote jsonb;

COMMENT ON COLUMN public.factura_electronica.sifen_ultima_respuesta_consulta_lote IS
  'Última respuesta parseada de consulta-lote TEST: dCodResLot, dMsgResLot, detalle por CDC (gResProcLote).';
