-- Actividad económica principal del emisor (SIFEN gEmis.gActEco: cActEco, dDesActEco).
ALTER TABLE public.empresa_sifen_config
  ADD COLUMN IF NOT EXISTS actividad_economica_codigo text NULL,
  ADD COLUMN IF NOT EXISTS actividad_economica_descripcion text NULL;

COMMENT ON COLUMN public.empresa_sifen_config.actividad_economica_codigo IS
  'Código de actividad económica principal según catálogo SET (cActEco).';
COMMENT ON COLUMN public.empresa_sifen_config.actividad_economica_descripcion IS
  'Descripción oficial asociada al código (dDesActEco); debe coincidir con la SET.';
