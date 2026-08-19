/**
 * Clasificación ABC de productos por rotación (cantidad vendida en un período).
 *
 * FUENTE ÚNICA de la lógica A/B/C: la usa el reporte de rotación y el listado de
 * productos (para no duplicar criterios). Método: Pareto por CANTIDAD vendida
 * (unidades). Los productos se ordenan de mayor a menor cantidad y se acumula su
 * participación sobre el total de unidades del período:
 *   - A: acumulan hasta cumA del volumen  → muy vendidos / alta rotación
 *   - B: hasta cumB                        → medianamente vendidos
 *   - C: el resto + los que NO tuvieron ventas → poca o ninguna rotación
 *
 * Umbrales AJUSTABLES en ABC_CONFIG.
 */

export type RangoABC = "A" | "B" | "C";

export const ABC_CONFIG = {
  /** Participación acumulada de unidades que define la clase A (0.80 = primer 80%). */
  cumA: 0.8,
  /** Participación acumulada que define la clase B (0.80–0.95). El resto es C. */
  cumB: 0.95,
} as const;

export const RANGO_LABEL: Record<RangoABC, string> = {
  A: "A · Muy vendido",
  B: "B · Medio",
  C: "C · Poca/ninguna venta",
};

/**
 * Clasifica una lista de items (cada uno con `cantidad_vendida`) en A/B/C.
 * No muta la entrada; devuelve nuevos objetos con `rango` agregado.
 * Los items con cantidad_vendida <= 0 son C (sin ventas).
 */
export function clasificarABC<T extends { cantidad_vendida: number }>(
  items: T[],
  cfg: { cumA: number; cumB: number } = ABC_CONFIG
): (T & { rango: RangoABC })[] {
  const conVenta = items
    .filter((i) => i.cantidad_vendida > 0)
    .sort((a, b) => b.cantidad_vendida - a.cantidad_vendida);
  const totalQty = conVenta.reduce((s, i) => s + i.cantidad_vendida, 0);

  const rangoRef = new Map<T, RangoABC>();
  let cum = 0;
  for (const i of conVenta) {
    cum += i.cantidad_vendida;
    const share = totalQty > 0 ? cum / totalQty : 1;
    rangoRef.set(i, share <= cfg.cumA ? "A" : share <= cfg.cumB ? "B" : "C");
  }

  return items.map((i) => ({
    ...i,
    rango: (i.cantidad_vendida > 0 ? rangoRef.get(i) ?? "C" : "C") as RangoABC,
  }));
}
