import { NextRequest } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getComprasPanel } from "@/lib/reportes/server/compras-panel-pg";
import { asuncionRangeBoundsUtc } from "@/lib/fechas/asuncion-bounds";
import { sheetFromRows, buildXlsxBufferSheets, xlsxResponseHeaders } from "@/lib/excel/export";

const ESTADO_OC: Record<string, string> = {
  pendiente: "Pendiente",
  recibida_parcial: "Recibida parcial",
  recibida_total: "Recibida total",
  cancelada: "Cancelada",
};

/**
 * GET /api/reportes/compras-panel/export?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 * XLSX con 3 hojas: Resumen, Compras, Ordenados no comprados.
 */
export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const sp = new URL(request.url).searchParams;
    const desde = sp.get("desde") ?? "";
    const hasta = sp.get("hasta") ?? "";
    const { start, end } = asuncionRangeBoundsUtc(desde || null, hasta || null);
    const r = await getComprasPanel(schema, ctx.auth.empresa_id, { start, end, desde, hasta });

    const resumen = [
      { concepto: "Reporte", valor: "Compras" },
      { concepto: "Desde", valor: r.desde || "—" },
      { concepto: "Hasta", valor: r.hasta || "—" },
      { concepto: "Compras del período", valor: r.totales.total_compras },
      { concepto: "Monto comprado", valor: r.totales.monto_comprado },
      { concepto: "Órdenes pendientes", valor: r.totales.ordenes_pendientes },
      { concepto: "Monto pendiente estimado", valor: r.totales.monto_pendiente },
    ];

    const buf = buildXlsxBufferSheets([
      sheetFromRows("Resumen", resumen, [
        { header: "Concepto", value: (x) => x.concepto, width: 30 },
        { header: "Valor", value: (x) => x.valor, width: 30 },
      ]),
      sheetFromRows("Compras", r.compras, [
        { header: "Fecha", value: (c) => (c.fecha ? new Date(c.fecha) : ""), width: 20 },
        { header: "N° Compra", value: (c) => c.numero_control, width: 16 },
        { header: "N° Factura", value: (c) => c.numero_factura ?? "", width: 18 },
        { header: "Proveedor", value: (c) => c.proveedor_nombre, width: 30 },
        { header: "N° OC", value: (c) => c.orden_compra_numero ?? "", width: 14 },
        { header: "Ítems", value: (c) => c.items_count, width: 8 },
        { header: "Total", value: (c) => c.total, width: 16 },
        { header: "Estado", value: (c) => c.estado, width: 14 },
      ]),
      sheetFromRows("Ordenados no comprados", r.pendientes, [
        { header: "Fecha OC", value: (p) => (p.fecha ? new Date(p.fecha) : ""), width: 20 },
        { header: "N° OC", value: (p) => p.numero_oc, width: 14 },
        { header: "Proveedor", value: (p) => p.proveedor_nombre, width: 30 },
        { header: "Producto", value: (p) => p.producto_nombre, width: 32 },
        { header: "SKU", value: (p) => p.sku ?? "", width: 16 },
        { header: "Cant. ordenada", value: (p) => p.cantidad_ordenada, width: 14 },
        { header: "Cant. recibida", value: (p) => p.cantidad_recibida, width: 14 },
        { header: "Cant. pendiente", value: (p) => p.cantidad_pendiente, width: 14 },
        { header: "Precio", value: (p) => p.costo_unitario, width: 14 },
        { header: "Subtotal pendiente", value: (p) => p.subtotal_pendiente, width: 18 },
        { header: "Estado OC", value: (p) => ESTADO_OC[p.estado] ?? p.estado, width: 16 },
      ]),
    ]);

    const suf = desde && hasta ? `${desde}_${hasta}` : "periodo";
    return new Response(new Uint8Array(buf), { status: 200, headers: xlsxResponseHeaders(`compras-${suf}`) });
  } catch (err) {
    console.error("[/api/reportes/compras-panel/export]", err instanceof Error ? err.message : err);
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
}
