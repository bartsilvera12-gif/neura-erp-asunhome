-- Validación de comprobantes (hash + OCR) por sesión de flujo; trazabilidad operativa.
-- Requiere: public.set_updated_at, public.puede_acceder_empresa

CREATE TABLE IF NOT EXISTS public.chat_comprobante_validaciones (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  conversation_id       uuid NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  flow_session_id       uuid NOT NULL REFERENCES public.chat_flow_sessions(id) ON DELETE CASCADE,
  channel_id            uuid REFERENCES public.chat_channels(id) ON DELETE SET NULL,
  flow_code             text NOT NULL DEFAULT '',
  comprobante_url       text,
  comprobante_media_id  text,
  comprobante_hash      text NOT NULL,
  estado_validacion     text NOT NULL DEFAULT 'pendiente'
    CHECK (estado_validacion IN (
      'pendiente',
      'valido',
      'duplicado_hash',
      'duplicado_ocr',
      'revision_manual',
      'ocr_error'
    )),
  motivo_validacion     text,
  ocr_text_raw          text,
  ocr_monto             text,
  ocr_referencia        text,
  ocr_fecha             text,
  ocr_hora              text,
  ocr_banco             text,
  ocr_fingerprint       text,
  sorteo_entrada_id     uuid REFERENCES public.sorteo_entradas(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_comp_val_empresa_hash
  ON public.chat_comprobante_validaciones(empresa_id, comprobante_hash);

CREATE INDEX IF NOT EXISTS idx_chat_comp_val_empresa_ocr_fp
  ON public.chat_comprobante_validaciones(empresa_id, ocr_fingerprint)
  WHERE ocr_fingerprint IS NOT NULL AND length(trim(ocr_fingerprint)) > 0;

CREATE INDEX IF NOT EXISTS idx_chat_comp_val_conversation
  ON public.chat_comprobante_validaciones(conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_comp_val_flow_session
  ON public.chat_comprobante_validaciones(flow_session_id);

CREATE INDEX IF NOT EXISTS idx_chat_comp_val_entrada
  ON public.chat_comprobante_validaciones(sorteo_entrada_id)
  WHERE sorteo_entrada_id IS NOT NULL;

COMMENT ON TABLE public.chat_comprobante_validaciones IS
  'Trazabilidad de comprobantes recibidos por WhatsApp: hash, OCR y decisión de validación por compra (flow_session).';

DROP TRIGGER IF EXISTS tr_chat_comp_val_updated ON public.chat_comprobante_validaciones;
CREATE TRIGGER tr_chat_comp_val_updated
  BEFORE UPDATE ON public.chat_comprobante_validaciones
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.chat_comprobante_validaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_comp_val_select" ON public.chat_comprobante_validaciones;
DROP POLICY IF EXISTS "chat_comp_val_insert" ON public.chat_comprobante_validaciones;
DROP POLICY IF EXISTS "chat_comp_val_update" ON public.chat_comprobante_validaciones;
DROP POLICY IF EXISTS "chat_comp_val_delete" ON public.chat_comprobante_validaciones;

CREATE POLICY "chat_comp_val_select" ON public.chat_comprobante_validaciones FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_comp_val_insert" ON public.chat_comprobante_validaciones FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_comp_val_update" ON public.chat_comprobante_validaciones FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_comp_val_delete" ON public.chat_comprobante_validaciones FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

ALTER TABLE public.sorteo_entradas
  ADD COLUMN IF NOT EXISTS comprobante_validacion_id uuid REFERENCES public.chat_comprobante_validaciones(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sorteo_ent_comp_val
  ON public.sorteo_entradas(comprobante_validacion_id)
  WHERE comprobante_validacion_id IS NOT NULL;

COMMENT ON COLUMN public.sorteo_entradas.comprobante_validacion_id IS
  'Vínculo opcional a la fila de validación OCR/hash del comprobante (WhatsApp).';
