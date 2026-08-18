/**
 * Montos de línea para `factura_items` alineados a SIFEN.
 * Misma lógica que `splitIvaIncluidoDesdeTotal` en `rde-xml.ts` (total / (1+t) → base).
 * El builder SIFEN infiere la tasa por ítem desde (subtotal, iva), por lo que basta con
 * que estos valores reflejen la tasa elegida — no se necesita columna extra.
 */

export type TasaIvaItem = 0 | 5 | 10;

export function montosFacturaItemGsPrecioIncluyeIva(
  totalLineaConIva: number,
  tasa: TasaIvaItem = 10
): { subtotal: number; iva: number; total: number } {
  const T = Math.round(Math.max(0, Number(totalLineaConIva)));
  if (T <= 0) return { subtotal: 0, iva: 0, total: 0 };
  if (tasa === 0) return { subtotal: T, iva: 0, total: T };
  const factor = tasa === 5 ? 1.05 : 1.1;
  const subtotal = Math.round(T / factor);
  const iva = T - subtotal;
  return { subtotal, iva, total: T };
}

/** Compat: comportamiento histórico (IVA 10%). */
export function montosFacturaItemGsPrecioIncluyeIva10(totalLineaConIva: number) {
  return montosFacturaItemGsPrecioIncluyeIva(totalLineaConIva, 10);
}

/**
 * Valores para insertar en `factura_items`.
 * GS: precio pactado incluye IVA según `tasaIva` (default 10) → descompone base / IVA / total.
 * USD: sin desglose IVA en ERP (el DE electrónico actual solo admite GS en `rde-xml`).
 */
export function montosFacturaItemParaInsert(input: {
  totalLinea: number;
  moneda: string;
  cantidad: number;
  precioUnitario: number;
  tasaIva?: TasaIvaItem;
}): { subtotal: number; iva: number; total: number; precio_unitario: number } {
  const c = Number(input.cantidad) > 0 ? Number(input.cantidad) : 1;
  const m = String(input.moneda || "GS").toUpperCase();
  const T = Math.round(Math.max(0, Number(input.totalLinea)));
  const puIn = Number(input.precioUnitario);
  const tasa: TasaIvaItem = input.tasaIva === 0 || input.tasaIva === 5 ? input.tasaIva : 10;

  if (m === "USD") {
    const precio_unitario = Number.isFinite(puIn) && puIn > 0 ? puIn : T / c;
    return { subtotal: T, iva: 0, total: T, precio_unitario };
  }

  const { subtotal, iva, total } = montosFacturaItemGsPrecioIncluyeIva(T, tasa);
  const precio_unitario =
    Number.isFinite(puIn) && puIn > 0 ? puIn : c === 1 ? total : total / c;
  return { subtotal, iva, total, precio_unitario };
}

/** Normaliza el string del payload UI ("exenta"|"iva_5"|"iva_10") a tasa numérica. Default 10. */
export function tasaIvaDesdeIvaTipo(v: unknown): TasaIvaItem {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (s === "exenta") return 0;
  if (s === "iva_5") return 5;
  return 10;
}
