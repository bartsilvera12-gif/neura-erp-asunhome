import { NextRequest } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getEstadoCuenta } from "@/lib/reportes/server/reportes-pg";
import { asuncionMesBoundsUtc, normalizarMes } from "@/lib/fechas/asuncion-bounds";
import { sheetFromRows, buildXlsxBufferSheets, xlsxResponseHeaders } from "@/lib/excel/export";

/** GET /api/reportes/estado-cuenta/export?mes=YYYY-MM → XLSX (Resumen + Movimientos). */
export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const mes = normalizarMes(new URL(request.url).searchParams.get("mes"));
    const { start, end } = asuncionMesBoundsUtc(mes);
    const r = await getEstadoCuenta(schema, ctx.auth.empresa_id, { mes, start, end, mesInicio: `${mes}-01` });

    const resumen = [
      { concepto: "Reporte", valor: "Estado de cuenta" },
      { concepto: "Mes", valor: mes },
      { concepto: "Ingresos por ventas", valor: r.ingresosVentas },
      { concepto: "Compras", valor: r.compras },
      { concepto: "Gastos", valor: r.gastos },
      { concepto: "Resultado (ventas - compras - gastos)", valor: r.resultado },
      { concepto: "Por cobrar (ventas a crédito)", valor: r.porCobrar },
      { concepto: "Por pagar (compras a crédito)", valor: r.porPagar },
    ];

    const buf = buildXlsxBufferSheets([
      sheetFromRows("Resumen", resumen, [
        { header: "Concepto", value: (x) => x.concepto, width: 40 },
        { header: "Valor", value: (x) => x.valor, width: 26 },
      ]),
      sheetFromRows("Movimientos", r.movimientos, [
        { header: "Fecha", value: (m) => (m.fecha ? new Date(m.fecha) : ""), width: 20 },
        { header: "Tipo", value: (m) => m.tipo, width: 12 },
        { header: "Referencia", value: (m) => m.referencia, width: 18 },
        { header: "Descripción", value: (m) => m.descripcion, width: 32 },
        { header: "Entrada", value: (m) => m.entrada, width: 16 },
        { header: "Salida", value: (m) => m.salida, width: 16 },
      ]),
    ]);
    return new Response(new Uint8Array(buf), { status: 200, headers: xlsxResponseHeaders(`estado-cuenta-${mes}`) });
  } catch (err) {
    console.error("[/api/reportes/estado-cuenta/export]", err instanceof Error ? err.message : err);
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
}
