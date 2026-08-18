-- Fecha de inicio de vigencia del timbrado (SIFEN gTimb.dFeIniT); debe coincidir con DNIT.
ALTER TABLE public.empresa_sifen_config
  ADD COLUMN IF NOT EXISTS timbrado_fecha_inicio_vigencia date NULL;

COMMENT ON COLUMN public.empresa_sifen_config.timbrado_fecha_inicio_vigencia IS
  'Inicio de vigencia del timbrado según resolución DNIT (XML dFeIniT).';
