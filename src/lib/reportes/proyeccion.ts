/**
 * Proyección de inventario: cobertura de stock en días según el ritmo de venta.
 *
 *   promedio_diario = cantidad_vendida_en_periodo / dias_del_periodo
 *   dias_cobertura  = stock_actual / promedio_diario
 *
 * Estados (umbrales ajustables en PROYECCION_CONFIG):
 *   - Sin stock      → stock_actual <= 0 (prioritario)
 *   - Sin movimiento → no hubo ventas en el período (no se divide por cero)
 *   - Crítico        → 0–7 días de cobertura
 *   - Bajo           → 8–15
 *   - Normal         → 16–30
 *   - Sobrestock     → más de 30
 */

export type EstadoStock =
  | "sin_stock"
  | "sin_movimiento"
  | "critico"
  | "bajo"
  | "normal"
  | "sobrestock";

export const PROYECCION_CONFIG = {
  /** Máximo de días de cobertura para "Crítico". */
  critico: 7,
  /** Máximo para "Bajo". */
  bajo: 15,
  /** Máximo para "Normal". Por encima → "Sobrestock". */
  normal: 30,
} as const;

export const ESTADO_STOCK_LABEL: Record<EstadoStock, string> = {
  sin_stock: "Sin stock",
  sin_movimiento: "Sin movimiento",
  critico: "Crítico",
  bajo: "Bajo",
  normal: "Normal",
  sobrestock: "Sobrestock",
};

export interface CoberturaResult {
  promedio_diario: number;
  /** Días estimados de cobertura. null cuando no hay ventas (sin movimiento). */
  dias_cobertura: number | null;
  estado: EstadoStock;
}

/**
 * Calcula promedio diario, días de cobertura y estado para un producto.
 * `dias` es la longitud del período (30/60/90).
 */
export function clasificarCobertura(
  stock_actual: number,
  cantidad_vendida: number,
  dias: number,
  cfg: { critico: number; bajo: number; normal: number } = PROYECCION_CONFIG
): CoberturaResult {
  const promedio = dias > 0 && cantidad_vendida > 0 ? cantidad_vendida / dias : 0;

  // Sin stock tiene prioridad (aunque haya tenido ventas).
  if (stock_actual <= 0) {
    return { promedio_diario: promedio, dias_cobertura: 0, estado: "sin_stock" };
  }
  // Sin ventas → sin movimiento (no dividir por cero).
  if (promedio <= 0) {
    return { promedio_diario: 0, dias_cobertura: null, estado: "sin_movimiento" };
  }
  const cobertura = stock_actual / promedio;
  const estado: EstadoStock =
    cobertura <= cfg.critico ? "critico"
    : cobertura <= cfg.bajo ? "bajo"
    : cobertura <= cfg.normal ? "normal"
    : "sobrestock";
  return { promedio_diario: promedio, dias_cobertura: cobertura, estado };
}
