import { NextRequest } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getReporteConciliacion } from "@/lib/reportes/server/reportes-pg";
import { asuncionMesBoundsUtc, normalizarMes } from "@/lib/fechas/asuncion-bounds";
import { sheetFromRows, buildXlsxBufferSheets, xlsxResponseHeaders } from "@/lib/excel/export";

const METODO: Record<string, string> = {
  efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta",
  qr: "QR", billetera: "Billetera", otro: "Otro",
};
const metodoLabel = (m: string | null) => (m ? METODO[m] ?? m : "");

/** GET /api/reportes/conciliacion/export?mes=YYYY-MM → XLSX (Resumen + Por método + Por entidad + Ventas). */
export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const mes = normalizarMes(new URL(request.url).searchParams.get("mes"));
    const { start, end } = asuncionMesBoundsUtc(mes);
    const r = await getReporteConciliacion(schema, ctx.auth.empresa_id, { mes, start, end, mesInicio: `${mes}-01` });

    const resumen = [
      { concepto: "Reporte", valor: "Conciliación bancaria" },
      { concepto: "Mes", valor: mes },
      { concepto: "Total cobrado (según detalle)", valor: r.totalCobrado },
      { concepto: "Operaciones", valor: r.cantidadOperaciones },
    ];

    const buf = buildXlsxBufferSheets([
      sheetFromRows("Resumen", resumen, [
        { header: "Concepto", value: (x) => x.concepto, width: 36 },
        { header: "Valor", value: (x) => x.valor, width: 24 },
      ]),
      sheetFromRows("Por método", r.porMetodo, [
        { header: "Método", value: (x) => metodoLabel(x.clave), width: 18 },
        { header: "Operaciones", value: (x) => x.cantidad, width: 12 },
        { header: "Total", value: (x) => x.total, width: 16 },
      ]),
      sheetFromRows("Por entidad", r.porEntidad, [
        { header: "Entidad", value: (x) => x.clave, width: 28 },
        { header: "Operaciones", value: (x) => x.cantidad, width: 12 },
        { header: "Total", value: (x) => x.total, width: 16 },
      ]),
      sheetFromRows("Movimientos", r.movimientos, [
        { header: "Fecha", value: (m) => (m.fecha ? new Date(m.fecha) : ""), width: 20 },
        { header: "Tipo", value: (m) => (m.tipo === "cobro" ? "Cobro CxC" : "Venta"), width: 12 },
        { header: "N° Venta", value: (m) => m.numero ?? "", width: 16 },
        { header: "Cliente", value: (m) => m.cliente ?? "", width: 26 },
        { header: "Método", value: (m) => metodoLabel(m.metodo_pago), width: 16 },
        { header: "Entidad", value: (m) => m.entidad ?? "", width: 24 },
        { header: "N° Comprobante", value: (m) => m.referencia ?? "", width: 20 },
        { header: "Titular", value: (m) => m.titular ?? "", width: 22 },
        { header: "Monto", value: (m) => m.monto, width: 16 },
        { header: "Estado", value: (m) => (m.estado === "aprobado" ? "Aprobado" : m.estado === "rechazado" ? "Rechazado" : "Pendiente"), width: 14 },
      ]),
    ]);
    return new Response(new Uint8Array(buf), { status: 200, headers: xlsxResponseHeaders(`conciliacion-${mes}`) });
  } catch (err) {
    console.error("[/api/reportes/conciliacion/export]", err instanceof Error ? err.message : err);
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
}
