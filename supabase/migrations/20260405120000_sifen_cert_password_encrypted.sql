-- =============================================================================
-- SIFEN: contraseña del certificado solo cifrada (AES-256-GCM en app con SIFEN_SECRETS_KEY)
-- Paso 1: agregar columna. Ejecutar scripts/migrate-sifen-certificado-password-to-encrypted.ts
-- antes del siguiente archivo de migración si existía certificado_password en claro.
-- =============================================================================

ALTER TABLE public.empresa_sifen_config
  ADD COLUMN IF NOT EXISTS certificado_password_encrypted text;

COMMENT ON COLUMN public.empresa_sifen_config.certificado_password_encrypted IS
  'Contraseña del .p12 cifrada en backend (neura:v1:...). Requiere SIFEN_SECRETS_KEY.';
