-- Dirección fiscal del emisor para el DE SIFEN (dDirEmi); no debe reutilizar razón social.
ALTER TABLE public.empresa_sifen_config
  ADD COLUMN IF NOT EXISTS direccion_fiscal text;

COMMENT ON COLUMN public.empresa_sifen_config.direccion_fiscal IS
  'Domicilio/calle del emisor para XML SIFEN (gEmis.dDirEmi). Distinto de razon_social.';

NOTIFY pgrst, 'reload schema';
