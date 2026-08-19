/**
 * Helpers de descuento promocional para productos.
 *
 * Modelo (compatible con ferreteriarepublica.productos):
 *   discount_type      'percentage' | 'fixed' | null
 *   discount_value     number (porcentaje 0-100 o monto Gs.)
 *   discount_starts_at ISO string | null  (null = sin restriccion)
 *   discount_ends_at   ISO string | null  (null = sin restriccion)
 *
 * "Producto en oferta" se DERIVA de los 4 campos + el reloj actual.
 * No hay flag `en_oferta` en DB: la verdad viene de isDiscountWindowActive().
 */

export type DiscountType = "percentage" | "fixed";

export interface ProductoConDescuento {
  precio_venta: number;
  discount_type?: DiscountType | string | null;
  discount_value?: number | string | null;
  discount_starts_at?: string | null;
  discount_ends_at?: string | null;
}

function toIsoMs(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * true si el descuento esta vigente AHORA.
 * Si starts_at o ends_at son null, no acotan ese lado de la ventana.
 */
export function isDiscountWindowActive(p: ProductoConDescuento, nowMs = Date.now()): boolean {
  const type = p.discount_type;
  const value = Number(p.discount_value ?? 0);
  if (!type || value <= 0) return false;
  if (type !== "percentage" && type !== "fixed") return false;
  const starts = toIsoMs(p.discount_starts_at);
  const ends = toIsoMs(p.discount_ends_at);
  if (starts !== null && nowMs < starts) return false;
  if (ends !== null && nowMs > ends) return false;
  return true;
}

/**
 * Precio efectivo (lo que paga el cliente). Si no hay descuento activo,
 * devuelve precio_venta. Nunca devuelve negativo (clamp a 0).
 */
export function getEffectivePrice(p: ProductoConDescuento, nowMs = Date.now()): number {
  const base = Number(p.precio_venta) || 0;
  if (!isDiscountWindowActive(p, nowMs)) return base;
  const value = Number(p.discount_value ?? 0);
  let efectivo: number;
  if (p.discount_type === "percentage") {
    efectivo = base - (base * value) / 100;
  } else {
    // fixed
    efectivo = base - value;
  }
  return Math.max(0, Math.round(efectivo));
}

/**
 * Porcentaje de descuento como ENTERO (0-100). Util para badges "-X%".
 * Para tipo 'percentage' devuelve el value tal cual; para 'fixed' lo calcula.
 */
export function getDiscountPercentage(p: ProductoConDescuento, nowMs = Date.now()): number {
  if (!isDiscountWindowActive(p, nowMs)) return 0;
  const base = Number(p.precio_venta) || 0;
  if (base <= 0) return 0;
  const efectivo = getEffectivePrice(p, nowMs);
  return Math.round(((base - efectivo) / base) * 100);
}
