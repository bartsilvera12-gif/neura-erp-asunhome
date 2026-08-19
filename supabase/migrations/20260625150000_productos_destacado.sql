-- =============================================================================
-- ferreteriarepublica.productos — columna `destacado`
--
-- Si destacado = true, el producto aparece en la seccion "Productos destacados"
-- del home del sitio publico (limitado a ~8 productos).
--
-- ALCANCE: SOLO el schema `ferreteriarepublica`. NO tocar otros tenants.
-- Idempotente.
-- =============================================================================

ALTER TABLE ferreteriarepublica.productos
  ADD COLUMN IF NOT EXISTS destacado boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN ferreteriarepublica.productos.destacado IS
  'Si true, aparece en la seccion Productos Destacados del sitio publico.';

-- Indice para acelerar la consulta WHERE destacado=true del endpoint del sitio.
CREATE INDEX IF NOT EXISTS idx_productos_destacado
  ON ferreteriarepublica.productos (empresa_id, destacado)
  WHERE destacado = true;
