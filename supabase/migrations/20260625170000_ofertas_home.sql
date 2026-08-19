-- =============================================================================
-- ferreteriarepublica — "Ofertas de la semana" (banner del home publico)
--
-- Cambios:
--  1) productos.oferta_semana_destacada boolean DEFAULT false
--     Flag para marcar productos que aparecen en el banner "Descuentos por
--     tiempo limitado" del home. Maximo 3 visibles a la vez (se enforza app-side).
--  2) empresas.ofertas_countdown_end timestamptz NULL
--     Fecha/hora de fin del countdown del banner. Si NULL o pasado, el banner
--     no muestra countdown.
--
-- Indice parcial para listar los destacados de oferta rapido.
--
-- ALCANCE: SOLO el schema `ferreteriarepublica`. Idempotente.
-- =============================================================================

ALTER TABLE ferreteriarepublica.productos
  ADD COLUMN IF NOT EXISTS oferta_semana_destacada boolean NOT NULL DEFAULT false;

ALTER TABLE ferreteriarepublica.empresas
  ADD COLUMN IF NOT EXISTS ofertas_countdown_end timestamptz;

COMMENT ON COLUMN ferreteriarepublica.productos.oferta_semana_destacada IS
  'Si true, aparece en el banner "Ofertas de la semana" del home publico (max 3).';

COMMENT ON COLUMN ferreteriarepublica.empresas.ofertas_countdown_end IS
  'Fecha/hora de fin del countdown del banner ofertas en el home. NULL = sin countdown.';

CREATE INDEX IF NOT EXISTS productos_oferta_semana_destacada_idx
  ON ferreteriarepublica.productos (empresa_id)
  WHERE oferta_semana_destacada = true;
