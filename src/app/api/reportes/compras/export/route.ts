import { NextRequest } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getReporteCompras } from "@/lib/reportes/server/reportes-pg";
import { asuncionMesBoundsUtc, normalizarMes } from "@/lib/fechas/asuncion-bounds";
import { sheetFromRows, buildXlsxBufferSheets, xlsxResponseHeaders } from "@/lib/excel/export";

/** GET /api/reportes/compras/export?mes=YYYY-MM → XLSX (Resumen + Por proveedor + Por producto + Compras + Items). */
export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const mes = normalizarMes(new URL(request.url).searchParams.get("mes"));
    const { start, end } = asuncionMesBoundsUtc(mes);
    const r = await getReporteCompras(schema, ctx.auth.empresa_id, { mes, start, end, mesInicio: `${mes}-01` });

    const resumen = [
      { concepto: "Reporte", valor: "Compras" },
      { concepto: "Mes", valor: mes },
      { concepto: "Total comprado", valor: r.totalComprado },
      { concepto: "Cantidad de compras", valor: r.cantidad },
      { concepto: "Cantidad de ítems (líneas)", valor: r.cantidadItems },
      { concepto: "Compra más alta", valor: r.compraMasAlta ? `${r.compraMasAlta.numero_control} · ${r.compraMasAlta.proveedor_nombre} (${r.compraMasAlta.total})` : "—" },
      { concepto: "Proveedor con mayor monto", valor: r.proveedorMayor ? `${r.proveedorMayor.proveedor_nombre} (${r.proveedorMayor.total})` : "—" },
      { concepto: "Producto más comprado (cant.)", valor: r.productoMasComprado ? `${r.productoMasComprado.producto_nombre} (${r.productoMasComprado.cantidad})` : "—" },
      { concepto: "Producto con mayor gasto", valor: r.productoMayorGasto ? `${r.productoMayorGasto.producto_nombre} (${r.productoMayorGasto.gasto})` : "—" },
    ];

    const buf = buildXlsxBufferSheets([
      sheetFromRows("Resumen", resumen, [
        { header: "Concepto", value: (x) => x.concepto, width: 34 },
        { header: "Valor", value: (x) => x.valor, width: 44 },
      ]),
      sheetFromRows("Por proveedor", r.porProveedor, [
        { header: "Proveedor", value: (x) => x.proveedor_nombre, width: 32 },
        { header: "Compras", value: (x) => x.compras, width: 12 },
        { header: "Total", value: (x) => x.total, width: 16 },
      ]),
      sheetFromRows("Por producto", r.porProducto, [
        { header: "Producto", value: (x) => x.producto_nombre, width: 32 },
        { header: "Cantidad", value: (x) => x.cantidad, width: 12 },
        { header: "Gasto", value: (x) => x.gasto, width: 16 },
      ]),
      sheetFromRows("Compras", r.compras, [
        { header: "Fecha", value: (c) => (c.fecha ? new Date(c.fecha) : ""), width: 20 },
        { header: "N° Compra", value: (c) => c.numero_control, width: 16 },
        { header: "Proveedor", value: (c) => c.proveedor_nombre, width: 30 },
        { header: "Ítems", value: (c) => c.items_count, width: 8 },
        { header: "Subtotal", value: (c) => c.subtotal, width: 14 },
        { header: "IVA", value: (c) => c.monto_iva, width: 14 },
        { header: "Total", value: (c) => c.total, width: 14 },
        { header: "Tipo de pago", value: (c) => c.tipo_pago, width: 12 },
        { header: "Timbrado", value: (c) => c.nro_timbrado ?? "", width: 18 },
        { header: "Comprobante", value: (c) => (c.tiene_comprobante ? "Sí" : "No"), width: 12 },
      ]),
      sheetFromRows("Items comprados", r.items, [
        { header: "Fecha", value: (i) => (i.fecha ? new Date(i.fecha) : ""), width: 20 },
        { header: "N° Compra", value: (i) => i.numero_control, width: 16 },
        { header: "Proveedor", value: (i) => i.proveedor_nombre, width: 30 },
        { header: "Producto", value: (i) => i.producto_nombre, width: 32 },
        { header: "Cantidad", value: (i) => i.cantidad, width: 10 },
        { header: "Costo unit.", value: (i) => i.costo_unitario, width: 14 },
        { header: "Total línea", value: (i) => i.total_linea, width: 14 },
      ]),
    ]);
    return new Response(new Uint8Array(buf), { status: 200, headers: xlsxResponseHeaders(`compras-${mes}`) });
  } catch (err) {
    console.error("[/api/reportes/compras/export]", err instanceof Error ? err.message : err);
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
}
