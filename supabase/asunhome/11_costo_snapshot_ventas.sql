-- 11_costo_snapshot_ventas.sql — Costo histórico correcto de la ganancia.
--
-- Problema: la ganancia se calculaba con productos.costo_promedio (costo ACTUAL).
-- Si el costo cambia por una compra nueva, la ganancia histórica se distorsiona.
--
-- Solución: guardar en cada línea de venta el COSTO AL MOMENTO DE LA VENTA
-- (snapshot). `ventas_items.costo_unitario` = costo por presentación vendida
-- (mismas unidades que precio_venta). La ganancia se calcula con este snapshot,
-- inmutable ante cambios de costo posteriores.
--
-- Idempotente.

ALTER TABLE asunhome.ventas_items
  ADD COLUMN IF NOT EXISTS costo_unitario numeric(14,2) NOT NULL DEFAULT 0;

-- Backfill de ventas anteriores: usa el snapshot de costo que ya guarda
-- movimientos_inventario (SALIDA) al vender. costo_por_presentacion =
-- (Σ cantidad_base * costo_unitario_base) / cantidad_presentaciones.
-- Solo aplica a productos que controlaban stock (los que tienen SALIDA).
UPDATE asunhome.ventas_items vi
   SET costo_unitario = ROUND(sub.costo_total / NULLIF(vi.cantidad, 0), 2)
  FROM (
    SELECT venta_id, producto_id, SUM(cantidad * costo_unitario) AS costo_total
      FROM asunhome.movimientos_inventario
     WHERE tipo = 'SALIDA' AND anulado_at IS NULL
     GROUP BY venta_id, producto_id
  ) sub
 WHERE vi.venta_id = sub.venta_id
   AND vi.producto_id = sub.producto_id
   AND vi.cantidad > 0
   AND vi.costo_unitario = 0;

NOTIFY pgrst, 'reload schema';

-- Verificación:
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='asunhome' AND table_name='ventas_items'
       AND column_name='costo_unitario')                       AS col_ok,           -- espera 1
  (SELECT count(*) FROM asunhome.ventas_items WHERE costo_unitario > 0) AS lineas_con_costo;
