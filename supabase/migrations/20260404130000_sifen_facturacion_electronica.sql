-- =============================================================================
-- SIFEN — capa de facturación electrónica (Paraguay)
-- Tablas nuevas únicamente; sin ALTER en facturas, clientes, etc.
-- Requiere: public.empresas, public.facturas, public.set_updated_at,
--           public.puede_acceder_empresa
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Configuración SIFEN por empresa (una fila por empresa)
-- -----------------------------------------------------------------------------
CREATE TABLE public.empresa_sifen_config (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id              uuid NOT NULL UNIQUE REFERENCES public.empresas(id) ON DELETE CASCADE,
  ambiente                text NOT NULL DEFAULT 'test'
    CHECK (ambiente IN ('test', 'produccion')),
  ruc                     text NOT NULL,
  razon_social            text NOT NULL,
  timbrado_numero         text NOT NULL,
  establecimiento         text NOT NULL,
  punto_expedicion        text NOT NULL,
  csc                     text,
  certificado_path        text,
  certificado_password    text,
  certificado_vencimiento timestamptz,
  activo                  boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.empresa_sifen_config IS
  'Configuración SET/SIFEN por empresa (timbrado, CSC, certificado).';
COMMENT ON COLUMN public.empresa_sifen_config.certificado_password IS
  'Almacenamiento provisional; preferir secret manager en producción.';

DROP TRIGGER IF EXISTS empresa_sifen_config_updated_at ON public.empresa_sifen_config;
CREATE TRIGGER empresa_sifen_config_updated_at
  BEFORE UPDATE ON public.empresa_sifen_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.empresa_sifen_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "empresa_sifen_config_select" ON public.empresa_sifen_config;
DROP POLICY IF EXISTS "empresa_sifen_config_insert" ON public.empresa_sifen_config;
DROP POLICY IF EXISTS "empresa_sifen_config_update" ON public.empresa_sifen_config;
DROP POLICY IF EXISTS "empresa_sifen_config_delete" ON public.empresa_sifen_config;

CREATE POLICY "empresa_sifen_config_select" ON public.empresa_sifen_config FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "empresa_sifen_config_insert" ON public.empresa_sifen_config FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "empresa_sifen_config_update" ON public.empresa_sifen_config FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "empresa_sifen_config_delete" ON public.empresa_sifen_config FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

-- -----------------------------------------------------------------------------
-- 2. Documento electrónico vinculado a factura ERP (1:1)
-- -----------------------------------------------------------------------------
CREATE TABLE public.factura_electronica (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  factura_id      uuid NOT NULL UNIQUE REFERENCES public.facturas(id) ON DELETE CASCADE,
  estado_sifen    text NOT NULL DEFAULT 'borrador'
    CHECK (estado_sifen IN (
      'borrador',
      'generado',
      'enviado',
      'aprobado',
      'rechazado'
    )),
  cdc             text,
  xml_path        text,
  kuDE_url        text,
  qr_data         text,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_factura_electronica_empresa ON public.factura_electronica(empresa_id);
CREATE INDEX idx_factura_electronica_factura ON public.factura_electronica(factura_id);
CREATE INDEX idx_factura_electronica_empresa_estado
  ON public.factura_electronica(empresa_id, estado_sifen);

COMMENT ON TABLE public.factura_electronica IS
  'Estado y artefactos del DE SIFEN asociado a una factura del ERP.';

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
-- 3. Eventos / trazabilidad del ciclo de vida del DE
-- -----------------------------------------------------------------------------
CREATE TABLE public.factura_electronica_evento (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id              uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  factura_electronica_id  uuid NOT NULL REFERENCES public.factura_electronica(id) ON DELETE CASCADE,
  tipo                    text NOT NULL
    CHECK (tipo IN ('generacion', 'envio', 'respuesta', 'error')),
  detalle                 jsonb,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_factura_electronica_evento_empresa
  ON public.factura_electronica_evento(empresa_id);
CREATE INDEX idx_factura_electronica_evento_de
  ON public.factura_electronica_evento(factura_electronica_id);
CREATE INDEX idx_factura_electronica_evento_empresa_created
  ON public.factura_electronica_evento(empresa_id, created_at DESC);

COMMENT ON TABLE public.factura_electronica_evento IS
  'Historial de generación, envío y respuestas SET para cada factura electrónica.';

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
