/**
 * Trazabilidad de movimientos de inventario: etiquetas legibles del origen y
 * de la operación (origen + referencia) para la pantalla de Movimientos.
 *
 * Lógica PURA (sin React) para poder testearla. La referencia ya viaja al
 * frontend (movimientos_inventario.referencia); acá solo se la formatea.
 *
 * Cubre TODOS los valores reales de movimientos_inventario.origen (el CHECK del
 * tenant), incluido `anulacion_venta` (nuevo). Los movimientos históricos de
 * anulación de venta quedaron con origen `ajuste_manual` y referencia
 * `ANUL-VTA-…`: se detectan por el prefijo de la referencia y se muestran igual
 * como "Anulación de venta VTA-…" sin tocar el dato histórico.
 */

import type { OrigenMovimiento } from "./types";

/** Etiqueta corta del origen (badge). Cubre los 13 orígenes reales. */
export const ORIGEN_LABEL: Record<OrigenMovimiento, string> = {
  compra: "Compra",
  venta: "Venta",
  ajuste_manual: "Ajuste manual",
  inventario_inicial: "Inventario inicial",
  produccion: "Producción",
  devolucion_venta: "Devolución venta",
  transferencia: "Transferencia",
  servicio_tecnico: "Servicio técnico",
  averia: "Avería",
  devolucion_proveedor: "Devolución proveedor",
  reserva: "Guarda",
  anulacion_reserva: "Anulación de guarda",
  anulacion_venta: "Anulación de venta",
};

/** Clases del badge de origen (paleta del sistema). */
export const ORIGEN_BADGE: Record<OrigenMovimiento, string> = {
  compra: "bg-sky-50 text-sky-700 border border-sky-200",
  venta: "bg-violet-50 text-violet-700 border border-violet-200",
  ajuste_manual: "bg-slate-100 text-slate-600 border border-slate-200",
  inventario_inicial: "bg-orange-50 text-orange-700 border border-orange-200",
  produccion: "bg-indigo-50 text-indigo-700 border border-indigo-200",
  devolucion_venta: "bg-amber-50 text-amber-800 border border-amber-200",
  transferencia: "bg-cyan-50 text-cyan-700 border border-cyan-200",
  servicio_tecnico: "bg-teal-50 text-teal-700 border border-teal-200",
  averia: "bg-rose-50 text-rose-700 border border-rose-200",
  devolucion_proveedor: "bg-amber-50 text-amber-800 border border-amber-200",
  reserva: "bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-200",
  anulacion_reserva: "bg-fuchsia-50 text-fuchsia-800 border border-fuchsia-200",
  anulacion_venta: "bg-red-50 text-red-700 border border-red-200",
};

/** Etiqueta del origen tolerante a valores desconocidos (no rompe la UI). */
export function origenLabel(origen: string): string {
  return ORIGEN_LABEL[origen as OrigenMovimiento] ?? "Otro";
}

/** Clases del badge tolerante a valores desconocidos. */
export function origenBadgeClass(origen: string): string {
  return ORIGEN_BADGE[origen as OrigenMovimiento] ?? "bg-slate-100 text-slate-600 border border-slate-200";
}

/**
 * Documento comercial asociado a un movimiento (columna "Factura / Comprobante").
 * Deriva del `origen` + `referencia` que ya viajan al frontend, sin duplicar datos:
 *   - Ventas → Nº VTA-… con `tipo: "venta"` (la pantalla lo enlaza al comprobante
 *     A4 usando `venta_id`).
 *   - Compras → Nº COMP-… con `tipo: "compra"` (se muestra como texto; no hay
 *     pantalla de detalle de compra).
 *   - Resto (guarda, ajuste, etc.) → `tipo: "otro"` con la referencia como texto.
 * Las anulaciones de venta (ref `ANUL-VTA-…`) se muestran con su Nº VTA subyacente.
 */
export function comprobanteMovimiento(
  origen: string,
  referencia?: string | null
): { numero: string | null; tipo: "venta" | "compra" | "otro" } {
  const ref = (referencia ?? "").trim();
  if (ref.startsWith("ANUL-VTA-")) return { numero: ref.slice(5), tipo: "venta" }; // "VTA-…"
  if (ref.startsWith("VTA-")) return { numero: ref, tipo: "venta" };
  if (ref.startsWith("COMP-")) return { numero: ref, tipo: "compra" };
  if (origen === "venta") return { numero: ref || null, tipo: "venta" };
  if (origen === "compra") return { numero: ref || null, tipo: "compra" };
  return { numero: ref || null, tipo: "otro" };
}

/**
 * "Operación / Referencia" legible. Deriva de `origen` + `referencia` sin
 * duplicar datos: usa la referencia que ya existe. Para movimientos antiguos sin
 * referencia y sin origen reconocible devuelve "Sin referencia histórica".
 */
export function operacionLabel(origen: string, referencia?: string | null): string {
  const ref = (referencia ?? "").trim();

  // 1) Por prefijo de la referencia (cubre históricos mal clasificados).
  if (ref) {
    if (ref.startsWith("ANUL-VTA-")) return `Anulación de venta ${ref.slice(5)}`;
    if (ref.startsWith("ANUL-RES-")) return `Anulación de guarda ${ref.slice(5)}`;
    if (ref.startsWith("ANUL-")) return `Anulación ${ref.slice(5)}`;
    if (ref.startsWith("VTA-")) return `Venta ${ref}`;
    if (ref.startsWith("RES-")) return `Guarda ${ref}`;
    if (ref.startsWith("COMP-")) return `Compra ${ref}`;
  }

  // 2) Por origen (+ referencia cuando hay).
  const withRef = (label: string) => (ref ? `${label} ${ref}` : label);
  switch (origen as OrigenMovimiento) {
    case "venta": return ref ? `Venta ${ref}` : "Venta";
    case "reserva": return ref ? `Guarda ${ref}` : "Guarda";
    case "anulacion_reserva": return withRef("Anulación de guarda");
    case "anulacion_venta": return withRef("Anulación de venta");
    case "devolucion_venta": return withRef("Devolución");
    case "devolucion_proveedor": return withRef("Devolución a proveedor");
    case "compra": return ref ? `Compra ${ref}` : "Compra";
    case "produccion": return withRef("Producción");
    case "transferencia": return withRef("Transferencia");
    case "servicio_tecnico": return withRef("Servicio técnico");
    case "averia": return withRef("Avería");
    case "inventario_inicial": return "Inventario inicial";
    case "ajuste_manual": return ref ? `Ajuste manual · ${ref}` : "Ajuste manual";
    default: return ref || "Sin referencia histórica";
  }
}
