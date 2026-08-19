-- Fase 2 Ventas (solo schema reservacaacupe): precio de distribuidor.
-- 1) Nuevo precio comercial de distribuidor en productos (NO usa costo_promedio).
-- 2) ventas_items.tipo_precio admite 'distribuidor'; se conserva 'costo' SOLO como
--    histórico (ventas viejas no se migran ni se rompen).
-- Idempotente. Aplicar con rol con privilegios DDL (supabase_admin).

ALTER TABLE reservacaacupe.productos
  ADD COLUMN IF NOT EXISTS precio_distribuidor numeric;

ALTER TABLE reservacaacupe.ventas_items
  DROP CONSTRAINT IF EXISTS ventas_items_tipo_precio_check;

ALTER TABLE reservacaacupe.ventas_items
  ADD CONSTRAINT ventas_items_tipo_precio_check
  CHECK (tipo_precio = ANY (ARRAY['minorista'::text, 'mayorista'::text, 'distribuidor'::text, 'costo'::text]));
