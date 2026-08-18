import type { Factura } from "./types";

/**
 * Estado coherente para listados (Cliente, estado de cuenta, etc.):
 * - `Corregida NC` en BD o saldo 0 con `Pendiente` (p. ej. antes de migración) → no se muestra como pendiente de cobro.
 * - Mora operativa: saldo > 0 y vencimiento calendario < hoy → `Vencido`.
 */
export function estadoFacturaParaUi(f: Pick<Factura, "estado" | "saldo" | "fecha_vencimiento">, hoyYmd: string): string {
  const est = String(f.estado ?? "").trim();
  const saldo = Number(f.saldo);
  const fv = (f.fecha_vencimiento ?? "").toString().trim().slice(0, 10);

  if (est === "Anulado") return "Anulado";
  if (est === "Pagado") return "Pagado";
  if (est === "Corregida NC") return "Corregida NC";

  if (Number.isFinite(saldo) && saldo <= 0.0001) {
    if (est === "Vencido") return "Pagado";
    if (est === "Pendiente") return "Corregida NC";
    return est || "Pendiente";
  }

  const estaVencida = fv.length >= 10 && fv < hoyYmd;
  if (estaVencida || est === "Vencido") return "Vencido";
  return est || "Pendiente";
}

export function clasesBadgeEstadoFacturaUi(estadoUi: string): string {
  switch (estadoUi) {
    case "Pagado":
      return "bg-green-100 text-green-700";
    case "Vencido":
      return "bg-red-100 text-red-700";
    case "Anulado":
      return "bg-gray-100 text-gray-500";
    case "Corregida NC":
      return "bg-teal-100 text-teal-800";
    default:
      return "bg-amber-100 text-amber-700";
  }
}

export function textoBadgeEstadoFacturaUi(estadoUi: string): string {
  return estadoUi === "Corregida NC" ? "Corregida (NC SET)" : estadoUi;
}
