-- =============================================================================
-- SIFEN: elimina columna de contraseña en texto plano (solo certificado_password_encrypted)
-- Aplicar solo después de migrar datos con scripts/migrate-sifen-certificado-password-to-encrypted.ts
-- si la columna certificado_password tenía valores.
-- =============================================================================

ALTER TABLE public.empresa_sifen_config
  DROP COLUMN IF EXISTS certificado_password;
