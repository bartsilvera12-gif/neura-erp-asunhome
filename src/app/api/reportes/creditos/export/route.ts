import { NextRequest } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getCreditosReporte } from "@/lib/reportes/server/creditos-pg";
import { sheetFromRows, buildXlsxBufferSheets, xlsxResponseHeaders } from "@/lib/excel/export";

/** GET /api/reportes/creditos/export → XLSX (Resumen + Clientes con aging). */
export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const r = await getCreditosReporte(schema, ctx.auth.empresa_id);

    const resumen = [
      { concepto: "Reporte", valor: "Créditos por cliente" },
      { concepto: "Clientes con saldo", valor: r.totales.clientes_con_saldo },
      { concepto: "Ventas a crédito", valor: r.totales.ventas_credito },
      { concepto: "Total a crédito", valor: r.totales.total_credito },
      { concepto: "Cobrado", valor: r.totales.total_cobrado },
      { concepto: "Saldo pendiente", valor: r.totales.saldo_pendiente },
      { concepto: "Vencido total", valor: r.totales.monto_vencido },
      { concepto: "Por vencer", valor: r.totales.por_vencer },
      { concepto: "Vencido 1-30 días", valor: r.totales.vencido_1_30 },
      { concepto: "Vencido 31-60 días", valor: r.totales.vencido_31_60 },
      { concepto: "Vencido 61-90 días", valor: r.totales.vencido_61_90 },
      { concepto: "Vencido +90 días", valor: r.totales.vencido_90_mas },
    ];

    const buf = buildXlsxBufferSheets([
      sheetFromRows("Resumen", resumen, [
        { header: "Concepto", value: (x) => x.concepto, width: 30 },
        { header: "Valor", value: (x) => x.valor, width: 24 },
      ]),
      sheetFromRows("Clientes", r.clientes, [
        { header: "Cliente", value: (c) => c.cliente_nombre, width: 34 },
        { header: "RUC / CI", value: (c) => c.cliente_ruc ?? "", width: 16 },
        { header: "Ventas a crédito", value: (c) => c.ventas_credito, width: 14 },
        { header: "Total", value: (c) => c.total, width: 16 },
        { header: "Cobrado", value: (c) => c.cobrado, width: 16 },
        { header: "Saldo", value: (c) => c.saldo, width: 16 },
        { header: "Por vencer", value: (c) => c.por_vencer, width: 14 },
        { header: "Vencido 1-30", value: (c) => c.vencido_1_30, width: 14 },
        { header: "Vencido 31-60", value: (c) => c.vencido_31_60, width: 14 },
        { header: "Vencido 61-90", value: (c) => c.vencido_61_90, width: 14 },
        { header: "Vencido +90", value: (c) => c.vencido_90_mas, width: 14 },
        { header: "Próx. vencimiento", value: (c) => (c.proximo_vencimiento ? new Date(c.proximo_vencimiento) : ""), width: 18 },
      ]),
    ]);
    return new Response(new Uint8Array(buf), { status: 200, headers: xlsxResponseHeaders("creditos-por-cliente") });
  } catch (err) {
    console.error("[/api/reportes/creditos/export]", err instanceof Error ? err.message : err);
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
}
