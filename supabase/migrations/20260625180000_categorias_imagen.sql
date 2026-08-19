-- =============================================================================
-- ferreteriarepublica.categorias_productos.imagen_url
--
-- Permite asignar una imagen a cada categoria, usada en el carrusel de
-- "Categorias destacadas" del home del sitio publico.
--
-- ALCANCE: SOLO `ferreteriarepublica`. Idempotente.
-- =============================================================================

ALTER TABLE ferreteriarepublica.categorias_productos
  ADD COLUMN IF NOT EXISTS imagen_url text;

COMMENT ON COLUMN ferreteriarepublica.categorias_productos.imagen_url IS
  'URL de imagen para mostrar en el carrusel del home publico.';
