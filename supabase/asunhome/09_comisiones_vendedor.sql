-- 09_comisiones_vendedor.sql
-- Comisiones por vendedor (modelo ASUNHOME): % fijo del TOTAL de ventas, editable
-- por vendedor, reporte mensual. Distinto del modelo por ganancia/escalas de ferrecolor.
--
-- · usuarios.es_vendedor        → aparece en el selector de vendedor y en el reporte
-- · usuarios.porcentaje_comision→ % sobre el total de sus ventas (ej. 0.25 = 0,25%)
-- · ventas.vendedor_id          → vendedor acreditado (puede diferir del cajero created_by)
-- · ventas.vendedor_nombre      → snapshot del nombre al momento de la venta
--
-- Vendedores iniciales (confirmado por el cliente): Armando y Norma al 0,25%.
--   Norma = admin@asunhome.com (se le corrige el nombre a 'Norma').
--   Armando = armando@admin.com
-- Idempotente.

ALTER TABLE asunhome.usuarios
  ADD COLUMN IF NOT EXISTS es_vendedor boolean NOT NULL DEFAULT false;

ALTER TABLE asunhome.ventas
  ADD COLUMN IF NOT EXISTS vendedor_id     uuid,
  ADD COLUMN IF NOT EXISTS vendedor_nombre text;

-- Norma (admin@asunhome.com): vendedora, 0,25%, nombre corregido.
UPDATE asunhome.usuarios
   SET es_vendedor = true,
       porcentaje_comision = 0.25,
       nombre = 'Norma'
 WHERE email = 'admin@asunhome.com';

-- Armando: vendedor, 0,25%.
UPDATE asunhome.usuarios
   SET es_vendedor = true,
       porcentaje_comision = 0.25
 WHERE email = 'armando@admin.com';

NOTIFY pgrst, 'reload schema';

-- Verificación:
SELECT nombre, email, es_vendedor, porcentaje_comision
FROM asunhome.usuarios
WHERE es_vendedor = true
ORDER BY nombre;
