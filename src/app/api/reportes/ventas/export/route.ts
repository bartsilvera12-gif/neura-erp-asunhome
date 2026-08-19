import { NextRequest } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getReporteVentas } from "@/lib/reportes/server/reportes-pg";
import { asuncionMesBoundsUtc, normalizarMes } from "@/lib/fechas/asuncion-bounds";
import { sheetFromRows, buildXlsxBufferSheets, xlsxResponseHeaders } from "@/lib/excel/export";

const TP_LABEL: Record<string, string> = { minorista: "Minorista", mayorista: "Mayorista", distribuidor: "Distribuidor", costo: "Al costo" };

/** GET /api/reportes/ventas/export?mes=YYYY-MM → XLSX (Resumen + Por tipo de precio + Por producto + Ventas + Items). */
export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const mes = normalizarMes(new URL(request.url).searchParams.get("mes"));
    const { start, end } = asuncionMesBoundsUtc(mes);
    const r = await getReporteVentas(schema, ctx.auth.empresa_id, { mes, start, end, mesInicio: `${mes}-01` });

    const resumen = [
      { concepto: "Reporte", valor: "Ventas" },
      { concepto: "Mes", valor: mes },
      { concepto: "Total vendido", valor: r.totalVendido },
      { concepto: "Cantidad de ventas", valor: r.cantidadVentas },
      { concepto: "Cantidad de ítems (líneas)", valor: r.cantidadItems },
      { concepto: "Ticket promedio", valor: Math.round(r.ticketPromedio) },
      { concepto: "Unidades vendidas", valor: r.unidadesVendidas },
    ];

    const tipoRows = (["minorista", "mayorista", "distribuidor", "costo"] as const).map((t) => ({
      tipo: TP_LABEL[t], items: r.porTipoPrecio[t].items, total: r.porTipoPrecio[t].total,
    }));

    const buf = buildXlsxBufferSheets([
      sheetFromRows("Resumen", resumen, [
        { header: "Concepto", value: (x) => x.concepto, width: 34 },
        { header: "Valor", value: (x) => x.valor, width: 30 },
      ]),
      sheetFromRows("Por tipo de precio", tipoRows, [
        { header: "Tipo de precio", value: (x) => x.tipo, width: 16 },
        { header: "Ítems", value: (x) => x.items, width: 10 },
        { header: "Total", value: (x) => x.total, width: 16 },
      ]),
      sheetFromRows("Por producto", r.porProducto, [
        { header: "Producto", value: (x) => x.producto_nombre, width: 32 },
        { header: "Cantidad", value: (x) => x.cantidad, width: 12 },
        { header: "Total", value: (x) => x.total, width: 16 },
      ]),
      sheetFromRows("Ventas", r.ventas, [
        { header: "Fecha", value: (v) => (v.fecha ? new Date(v.fecha) : ""), width: 20 },
        { header: "N° Venta", value: (v) => v.numero_control, width: 16 },
        { header: "Cliente", value: (v) => v.cliente ?? "", width: 28 },
        { header: "Método pago", value: (v) => v.metodo_pago ?? "", width: 14 },
        { header: "Ítems", value: (v) => v.items_count, width: 8 },
        { header: "Total", value: (v) => v.total, width: 16 },
      ]),
      sheetFromRows("Items vendidos", r.items, [
        { header: "Fecha", value: (i) => (i.fecha ? new Date(i.fecha) : ""), width: 20 },
        { header: "N° Venta", value: (i) => i.numero_control, width: 16 },
        { header: "Producto", value: (i) => i.producto_nombre, width: 32 },
        { header: "Tipo de precio", value: (i) => TP_LABEL[i.tipo_precio] ?? i.tipo_precio, width: 14 },
        { header: "Cantidad", value: (i) => i.cantidad, width: 10 },
        { header: "Precio unit.", value: (i) => i.precio_venta, width: 14 },
        { header: "Subtotal", value: (i) => i.subtotal, width: 14 },
        { header: "IVA", value: (i) => i.monto_iva, width: 14 },
        { header: "Total línea", value: (i) => i.total_linea, width: 14 },
      ]),
    ]);
    return new Response(new Uint8Array(buf), { status: 200, headers: xlsxResponseHeaders(`ventas-${mes}`) });
  } catch (err) {
    console.error("[/api/reportes/ventas/export]", err instanceof Error ? err.message : err);
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
}
