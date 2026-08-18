-- =============================================================================
-- Asegura public.empresa_sifen_config cuando el proyecto remoto no aplicó
-- migraciones SIFEN previas (error PostgREST: tabla no encontrada).
-- Esquema alineado con la API: timbrado_numero, certificado_password_encrypted.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.empresa_sifen_config (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id              uuid NOT NULL UNIQUE REFERENCES public.empresas(id) ON DELETE CASCADE,
  ambiente                text NOT NULL DEFAULT 'test',
  ruc                     text NOT NULL,
  razon_social            text NOT NULL,
  timbrado_numero         text NOT NULL,
  establecimiento         text NOT NULL,
  punto_expedicion        text NOT NULL,
  csc                     text,
  certificado_path        text,
  certificado_vencimiento timestamptz,
  activo                  boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT empresa_sifen_config_ambiente_check CHECK (ambiente IN ('test', 'produccion'))
);

ALTER TABLE public.empresa_sifen_config
  ADD COLUMN IF NOT EXISTS certificado_password_encrypted text;

COMMENT ON TABLE public.empresa_sifen_config IS
  'Configuración SET/SIFEN por empresa (timbrado, CSC, certificado).';
COMMENT ON COLUMN public.empresa_sifen_config.certificado_password_encrypted IS
  'Contraseña del .p12 cifrada en backend (neura:v1:...). Requiere SIFEN_SECRETS_KEY.';

-- Quitar columna en claro si quedó de migraciones antiguas (API ya no la usa)
ALTER TABLE public.empresa_sifen_config DROP COLUMN IF EXISTS certificado_password;

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

NOTIFY pgrst, 'reload schema';
