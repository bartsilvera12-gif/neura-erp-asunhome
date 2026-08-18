/**
 * Helpers de neteo de factura para preview (sin depender de dashboard/data ni cliente).
 * Las filas NC provienen de la tabla tenant `nota_credito` (singular), no `notas_credito`.
 */

export interface FacturaPreviewRow {
  id: number | string;
  cliente_id: number | string;
  numero_factura?: string;
  fecha: string;
  monto: number;
  saldo: number;
  estado: string;
}

export interface NotaCreditoPreviewRow {
  factura_id: string;
  monto: number;
  estado_erp: string;
}

export function esFacturaAnuladaPreview(estado: string | null | undefined): boolean {
  return String(estado ?? "").trim().toLowerCase() === "anulado";
}

export function esFacturaCorregidaNcPreview(estado: string | null | undefined): boolean {
  return String(estado ?? "").trim().toLowerCase() === "corregida nc";
}

export function buildMontoNcAprobadaPorFacturaIdPreview(
  rows: NotaCreditoPreviewRow[]
): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (String(r.estado_erp ?? "").trim().toLowerCase() !== "aprobada") continue;
    const fid = String(r.factura_id);
    m.set(fid, (m.get(fid) ?? 0) + (Number(r.monto) || 0));
  }
  return m;
}

export function montoFacturaNetoValorComercialPreview(
  f: FacturaPreviewRow,
  ncPorFactura: Map<string, number>
): number {
  if (esFacturaAnuladaPreview(f.estado)) return 0;
  if (esFacturaCorregidaNcPreview(f.estado)) return 0;
  const monto = Number(f.monto) || 0;
  const ncTotal = ncPorFactura.get(String(f.id)) ?? 0;
  const net = monto - ncTotal;
  return net > 0.01 ? net : 0;
}
