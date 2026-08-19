-- Costeo de recetas con CONVERSIÓN de unidades por familia (solo reservacaacupe).
-- masa: G=1, KG=1000 | volumen: ML=1, L/LT=1000 | conteo: UNIDAD=1.
-- subcosto = (cantidad_item * factor_item / factor_insumo) * (1+merma) * costo_promedio
-- Si la unidad del ítem y la del insumo son de familias distintas (incompatibles),
-- NO se infla: subcosto=0 y unidad_incompatible=true (la UI/venta lo tratan aparte).
-- No inventa densidades. Idempotente (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION reservacaacupe.fn_receta_costeo(p_receta_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'reservacaacupe', 'public'
AS $function$
DECLARE
  v_costo_total       numeric := 0;
  v_precio_venta      numeric := 0;
  v_rendimiento       numeric := 1;
  v_unidades_posibles numeric;
  v_items             jsonb;
  v_producto_id       uuid;
BEGIN
  SELECT r.producto_id, COALESCE(r.rendimiento_cantidad, 1), COALESCE(p.precio_venta, 0)
    INTO v_producto_id, v_rendimiento, v_precio_venta
  FROM reservacaacupe.recetas r
  JOIN reservacaacupe.productos p ON p.id = r.producto_id
  WHERE r.id = p_receta_id;

  IF v_producto_id IS NULL THEN
    RETURN jsonb_build_object('error', 'receta_no_encontrada');
  END IF;

  WITH base AS (
    SELECT
      ri.id, ri.insumo_producto_id, pi.nombre AS insumo_nombre, ri.orden,
      ri.cantidad, ri.unidad_medida, COALESCE(ri.merma_pct, 0) AS merma_pct,
      pi.costo_promedio, pi.stock_actual,
      upper(trim(COALESCE(NULLIF(ri.unidad_medida, ''), pi.unidad_medida))) AS u_item,
      upper(trim(pi.unidad_medida)) AS u_ins
    FROM reservacaacupe.receta_items ri
    JOIN reservacaacupe.productos pi ON pi.id = ri.insumo_producto_id
    WHERE ri.receta_id = p_receta_id
  ),
  fam AS (
    SELECT b.*,
      CASE u_item WHEN 'G' THEN 1 WHEN 'GR' THEN 1 WHEN 'GRS' THEN 1 WHEN 'KG' THEN 1000
                  WHEN 'ML' THEN 1 WHEN 'L' THEN 1000 WHEN 'LT' THEN 1000 WHEN 'LTS' THEN 1000
                  WHEN 'UNIDAD' THEN 1 WHEN 'UNID' THEN 1 WHEN 'U' THEN 1 ELSE NULL END AS f_item,
      CASE u_ins  WHEN 'G' THEN 1 WHEN 'GR' THEN 1 WHEN 'GRS' THEN 1 WHEN 'KG' THEN 1000
                  WHEN 'ML' THEN 1 WHEN 'L' THEN 1000 WHEN 'LT' THEN 1000 WHEN 'LTS' THEN 1000
                  WHEN 'UNIDAD' THEN 1 WHEN 'UNID' THEN 1 WHEN 'U' THEN 1 ELSE NULL END AS f_ins,
      CASE
        WHEN u_item IN ('G','GR','GRS','KG') AND u_ins IN ('G','GR','GRS','KG') THEN true
        WHEN u_item IN ('ML','L','LT','LTS') AND u_ins IN ('ML','L','LT','LTS') THEN true
        WHEN u_item IN ('UNIDAD','UNID','U') AND u_ins IN ('UNIDAD','UNID','U') THEN true
        ELSE false
      END AS compat
    FROM base b
  ),
  item_calc AS (
    SELECT *,
      (CASE WHEN compat AND f_ins > 0 THEN cantidad * f_item / f_ins ELSE NULL END) AS cant_insumo,
      (CASE WHEN compat AND f_ins > 0 THEN (cantidad * f_item / f_ins) * (1 + merma_pct) ELSE NULL END) AS cantidad_efectiva,
      (CASE WHEN compat AND f_ins > 0 THEN (cantidad * f_item / f_ins) * (1 + merma_pct) * COALESCE(costo_promedio, 0) ELSE 0 END) AS subcosto,
      (CASE WHEN compat AND f_ins > 0 AND (cantidad * f_item / f_ins) * (1 + merma_pct) > 0
            THEN FLOOR(COALESCE(stock_actual, 0) / ((cantidad * f_item / f_ins) * (1 + merma_pct)))
            ELSE NULL END) AS unidades_aporte,
      (NOT compat) AS unidad_incompatible
    FROM fam
  )
  SELECT
    COALESCE(SUM(subcosto), 0),
    COALESCE(MIN(unidades_aporte), 0),
    COALESCE(jsonb_agg(jsonb_build_object(
      'item_id', id,
      'insumo_producto_id', insumo_producto_id,
      'insumo_nombre', insumo_nombre,
      'cantidad', cantidad,
      'unidad_medida', unidad_medida,
      'merma_pct', merma_pct,
      'costo_promedio', costo_promedio,
      'stock_actual', stock_actual,
      'subcosto', subcosto,
      'unidades_aporte', unidades_aporte,
      'unidad_incompatible', unidad_incompatible
    ) ORDER BY orden, insumo_nombre), '[]'::jsonb)
    INTO v_costo_total, v_unidades_posibles, v_items
  FROM item_calc;

  IF NOT EXISTS (SELECT 1 FROM reservacaacupe.receta_items WHERE receta_id = p_receta_id) THEN
    v_unidades_posibles := NULL;
  END IF;

  RETURN jsonb_build_object(
    'receta_id', p_receta_id,
    'producto_id', v_producto_id,
    'rendimiento_cantidad', v_rendimiento,
    'costo_total', v_costo_total,
    'costo_unitario', CASE WHEN v_rendimiento > 0 THEN v_costo_total / v_rendimiento ELSE NULL END,
    'precio_venta', v_precio_venta,
    'margen_abs', v_precio_venta - (CASE WHEN v_rendimiento > 0 THEN v_costo_total / v_rendimiento ELSE 0 END),
    'margen_pct', CASE
      WHEN v_precio_venta > 0 AND v_rendimiento > 0
      THEN ROUND(((v_precio_venta - (v_costo_total / v_rendimiento)) / v_precio_venta * 100)::numeric, 2)
      ELSE NULL
    END,
    'unidades_posibles', v_unidades_posibles,
    'items', v_items
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION reservacaacupe.fn_receta_costeo(uuid) TO anon, authenticated, service_role;
