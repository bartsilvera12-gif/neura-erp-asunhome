-- Limpia TODO rastro del producto PRUEBA (SKU REV-0034):
--   * movimientos_inventario del producto
--   * ventas que SOLO contengan PRUEBA (items, pagos_detalle, caja_movimientos asociados)
--   * devoluciones_venta ligadas a esas ventas
-- No toca ventas mixtas que ademas incluyan otros productos.
--
-- Corre en Supabase SQL editor, schema del tenant Ferrecolor.

SET search_path TO ferrecolor, public;

-- ══════════════════════════════════════════════════════════════════
-- PREVIEW (ejecuta este bloque primero, verifica los resultados)
-- ══════════════════════════════════════════════════════════════════

-- Ventas que SOLO tienen PRUEBA (candidatas a borrar por completo)
WITH ventas_prueba_solo AS (
  SELECT v.id, v.numero_control, v.estado, v.total
    FROM ventas v
   WHERE NOT EXISTS (
     SELECT 1 FROM ventas_items vi
      WHERE vi.venta_id = v.id AND (vi.producto_sku IS DISTINCT FROM 'REV-0034')
   )
     AND EXISTS (
     SELECT 1 FROM ventas_items vi
      WHERE vi.venta_id = v.id AND vi.producto_sku = 'REV-0034'
   )
)
SELECT * FROM ventas_prueba_solo;

-- Movimientos de inventario a borrar
SELECT COUNT(*) AS mov_inv_a_borrar
  FROM movimientos_inventario
 WHERE producto_sku = 'REV-0034';

-- Caja movimientos ligados (por venta_id de las ventas anteriores)
SELECT COUNT(*) AS caja_movs_a_borrar
  FROM caja_movimientos cm
 WHERE cm.venta_id IN (
   SELECT v.id FROM ventas v
    WHERE NOT EXISTS (SELECT 1 FROM ventas_items vi WHERE vi.venta_id = v.id AND vi.producto_sku IS DISTINCT FROM 'REV-0034')
      AND EXISTS      (SELECT 1 FROM ventas_items vi WHERE vi.venta_id = v.id AND vi.producto_sku = 'REV-0034')
 );

-- Producto y stock actual
SELECT id, sku, nombre, stock_actual FROM productos WHERE sku = 'REV-0034';


-- ══════════════════════════════════════════════════════════════════
-- EJECUCION (solo si el preview arriba es lo esperado)
-- ══════════════════════════════════════════════════════════════════

BEGIN;

-- 1) IDs de ventas que solo contienen PRUEBA
CREATE TEMP TABLE _ventas_prueba ON COMMIT DROP AS
  SELECT v.id
    FROM ventas v
   WHERE NOT EXISTS (SELECT 1 FROM ventas_items vi WHERE vi.venta_id = v.id AND vi.producto_sku IS DISTINCT FROM 'REV-0034')
     AND EXISTS      (SELECT 1 FROM ventas_items vi WHERE vi.venta_id = v.id AND vi.producto_sku = 'REV-0034');

-- 2) Devoluciones ligadas a esas ventas (items, cambios, cabecera)
DELETE FROM devoluciones_venta_items WHERE devolucion_id IN (
  SELECT id FROM devoluciones_venta WHERE venta_id IN (SELECT id FROM _ventas_prueba)
);
DELETE FROM devoluciones_venta_cambios WHERE devolucion_id IN (
  SELECT id FROM devoluciones_venta WHERE venta_id IN (SELECT id FROM _ventas_prueba)
);
DELETE FROM devoluciones_venta WHERE venta_id IN (SELECT id FROM _ventas_prueba);

-- 3) Caja movimientos ligados a esas ventas
DELETE FROM caja_movimientos WHERE venta_id IN (SELECT id FROM _ventas_prueba);

-- 4) Cuentas por cobrar ligadas
DELETE FROM cuentas_por_cobrar WHERE venta_id IN (SELECT id FROM _ventas_prueba);

-- 5) Pagos detalle e items de la venta
DELETE FROM ventas_pagos_detalle WHERE venta_id IN (SELECT id FROM _ventas_prueba);
DELETE FROM ventas_items         WHERE venta_id IN (SELECT id FROM _ventas_prueba);

-- 6) La venta en si
DELETE FROM ventas WHERE id IN (SELECT id FROM _ventas_prueba);

-- 7) Todos los movimientos_inventario del producto
DELETE FROM movimientos_inventario WHERE producto_sku = 'REV-0034';

-- 8) Reset del stock del producto a 2 (valor original). Cambia si queres otro.
UPDATE productos SET stock_actual = 2, updated_at = now() WHERE sku = 'REV-0034';

-- Verificacion
SELECT sku, nombre, stock_actual FROM productos WHERE sku = 'REV-0034';
SELECT COUNT(*) AS mov_inv_restantes FROM movimientos_inventario WHERE producto_sku = 'REV-0034';

COMMIT;
-- ROLLBACK; -- <-- descomentar y usar en lugar de COMMIT si algo falla
