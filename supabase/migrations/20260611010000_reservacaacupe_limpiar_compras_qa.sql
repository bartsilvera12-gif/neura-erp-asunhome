-- Limpieza puntual AUTORIZADA de 2 compras QA con totales absurdos que distorsionaban
-- el reporte de Estado de cuenta (card Compras / Resultado). Solo schema reservacaacupe.
-- Ya ejecutada en producción; este archivo deja registro y es idempotente (no-op si ya se aplicó).
--
-- Snapshot previo (para auditoría):
--   COMP-000001 · id 5f7cf743 · QA TEST PRODUCTO · cant 5 · costo 5.000.050.000
--               · subtotal 25.000.250.000 · total 27.500.275.000
--   COMP-000002 · id 99f6b59f · QA TEST PRODUCTO · cant 500.005.000.050.000/u
--               · subtotal 2.500.025.000.250.000 · total 2.750.027.500.275.000
-- Generaron 2 movimientos ENTRADA (origen='compra') de 5 + 5 = 10 unidades de
-- 'QA TEST PRODUCTO' (id fd8bc38f). Stock revertido 18 -> 8.

DO $$
BEGIN
  -- 1) Revertir el stock que aportaron esas entradas (por producto).
  UPDATE reservacaacupe.productos p
     SET stock_actual = p.stock_actual - agg.qty, updated_at = now()
    FROM (
      SELECT producto_id, SUM(cantidad) AS qty
        FROM reservacaacupe.movimientos_inventario
       WHERE referencia IN ('COMP-000001','COMP-000002')
         AND origen = 'compra' AND tipo = 'ENTRADA'
       GROUP BY producto_id
    ) agg
   WHERE p.id = agg.producto_id;

  -- 2) Borrar los movimientos de inventario de esas compras.
  DELETE FROM reservacaacupe.movimientos_inventario
   WHERE referencia IN ('COMP-000001','COMP-000002') AND origen = 'compra';

  -- 3) Borrar las compras QA (modelo PLANO: no hay tabla compras_items).
  DELETE FROM reservacaacupe.compras
   WHERE numero_control IN ('COMP-000001','COMP-000002');
END $$;
