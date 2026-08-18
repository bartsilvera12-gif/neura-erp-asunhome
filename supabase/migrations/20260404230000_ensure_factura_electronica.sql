-- =============================================================================
-- Asegura public.factura_electronica y factura_electronica_evento (remotos sin
-- migraciones SIFEN completas). Esquema alineado con API borrador/xml/firmar.
-- NOTA: el código usa columna `error` (no error_message); no hay payload_json
-- en tabla — trazas en factura_electronica_evento.detalle (jsonb).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.factura_electronica (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  factura_id         uuid NOT NULL UNIQUE REFERENCES public.facturas(id) ON DELETE CASCADE,
  estado_sifen       text NOT NULL DEFAULT 'borrador',
  cdc                text,
  xml_path           text,
  xml_firmado_path   text,
  kuDE_url           text,
  qr_data            text,
  error              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.factura_electronica ADD COLUMN IF NOT EXISTS xml_firmado_path text;
ALTER TABLE public.factura_electronica ADD COLUMN IF NOT EXISTS kuDE_url text;
ALTER TABLE public.factura_electronica ADD COLUMN IF NOT EXISTS qr_data text;

COMMENT ON TABLE public.factura_electronica IS
  'Estado y artefactos del DE SIFEN asociado a una factura del ERP.';

CREATE INDEX IF NOT EXISTS idx_factura_electronica_empresa ON public.factura_electronica(empresa_id);
CREATE INDEX IF NOT EXISTS idx_factura_electronica_factura ON public.factura_electronica(factura_id);
CREATE INDEX IF NOT EXISTS idx_factura_electronica_empresa_estado
  ON public.factura_electronica(empresa_id, estado_sifen);

ALTER TABLE public.factura_electronica DROP CONSTRAINT IF EXISTS factura_electronica_estado_sifen_check;
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

DROP TRIGGER IF EXISTS factura_electronica_updated_at ON public.factura_electronica;
CREATE TRIGGER factura_electronica_updated_at
  BEFORE UPDATE ON public.factura_electronica
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.factura_electronica ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "factura_electronica_select" ON public.factura_electronica;
DROP POLICY IF EXISTS "factura_electronica_insert" ON public.factura_electronica;
DROP POLICY IF EXISTS "factura_electronica_update" ON public.factura_electronica;
DROP POLICY IF EXISTS "factura_electronica_delete" ON public.factura_electronica;

CREATE POLICY "factura_electronica_select" ON public.factura_electronica FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "factura_electronica_insert" ON public.factura_electronica FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "factura_electronica_update" ON public.factura_electronica FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "factura_electronica_delete" ON public.factura_electronica FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

-- -----------------------------------------------------------------------------
-- Eventos (obligatorio para borrador / xml / firmar / payload)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.factura_electronica_evento (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id             uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  factura_electronica_id uuid NOT NULL REFERENCES public.factura_electronica(id) ON DELETE CASCADE,
  tipo                   text NOT NULL,
  detalle                jsonb,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_factura_electronica_evento_empresa
  ON public.factura_electronica_evento(empresa_id);
CREATE INDEX IF NOT EXISTS idx_factura_electronica_evento_de
  ON public.factura_electronica_evento(factura_electronica_id);
CREATE INDEX IF NOT EXISTS idx_factura_electronica_evento_empresa_created
  ON public.factura_electronica_evento(empresa_id, created_at DESC);

COMMENT ON TABLE public.factura_electronica_evento IS
  'Historial de generación, envío y respuestas SET para cada factura electrónica.';

ALTER TABLE public.factura_electronica_evento DROP CONSTRAINT IF EXISTS factura_electronica_evento_tipo_check;
ALTER TABLE public.factura_electronica_evento
  ADD CONSTRAINT factura_electronica_evento_tipo_check
  CHECK (tipo IN ('generacion', 'envio', 'respuesta', 'error', 'firma'));

ALTER TABLE public.factura_electronica_evento ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "factura_electronica_evento_select" ON public.factura_electronica_evento;
DROP POLICY IF EXISTS "factura_electronica_evento_insert" ON public.factura_electronica_evento;
DROP POLICY IF EXISTS "factura_electronica_evento_update" ON public.factura_electronica_evento;
DROP POLICY IF EXISTS "factura_electronica_evento_delete" ON public.factura_electronica_evento;

CREATE POLICY "factura_electronica_evento_select" ON public.factura_electronica_evento FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "factura_electronica_evento_insert" ON public.factura_electronica_evento FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "factura_electronica_evento_update" ON public.factura_electronica_evento FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "factura_electronica_evento_delete" ON public.factura_electronica_evento FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

NOTIFY pgrst, 'reload schema';
