-- Etiqueta libre del averiado (Averiado, Recuperado, Exhibición, o la que elija
-- el admin). Se muestra en el inventario como "Producto — Etiqueta".
ALTER TABLE asunhome.productos_averiados
  ADD COLUMN IF NOT EXISTS etiqueta text;

-- Los averiados ya existentes quedan con etiqueta por defecto "Averiado".
UPDATE asunhome.productos_averiados
SET etiqueta = 'Averiado'
WHERE etiqueta IS NULL AND motivo = 'cliente';

NOTIFY pgrst, 'reload schema';
