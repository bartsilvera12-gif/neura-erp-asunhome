import { NextRequest } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getReporteProveedores } from "@/lib/reportes/server/reportes-pg";
import { asuncionMesBoundsUtc, normalizarMes } from "@/lib/fechas/asuncion-bounds";
import { sheetFromRows, buildXlsxBufferSheets, xlsxResponseHeaders } from "@/lib/excel/export";

/** GET /api/reportes/proveedores/export?mes=YYYY-MM → XLSX (Resumen + Proveedores + Compras por proveedor). */
export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const mes = normalizarMes(new URL(request.url).searchParams.get("mes"));
    const { start, end } = asuncionMesBoundsUtc(mes);
    const r = await getReporteProveedores(schema, ctx.auth.empresa_id, { mes, start, end, mesInicio: `${mes}-01` });

    const resumen = [
      { concepto: "Reporte", valor: "Proveedores" },
      { concepto: "Mes", valor: mes },
      { concepto: "Total proveedores", valor: r.totalProveedores },
      { concepto: "Proveedores con compras en el mes", valor: r.conCompras },
      { concepto: "Total comprado del mes", valor: r.totalComprado },
      { concepto: "Compra promedio por proveedor activo", valor: Math.round(r.compraPromedio) },
      { concepto: "Última compra", valor: r.ultimaCompra ? `${r.ultimaCompra.numero_control} · ${r.ultimaCompra.proveedor_nombre} (${r.ultimaCompra.total})` : "—" },
    ];

    const conCompras = r.proveedores.filter((p) => p.cantidad > 0);

    const buf = buildXlsxBufferSheets([
      sheetFromRows("Resumen", resumen, [
        { header: "Concepto", value: (x) => x.concepto, width: 40 },
        { header: "Valor", value: (x) => x.valor, width: 44 },
      ]),
      sheetFromRows("Proveedores", r.proveedores, [
        { header: "Proveedor", value: (p) => p.nombre, width: 32 },
        { header: "RUC", value: (p) => p.ruc ?? "", width: 16 },
        { header: "Teléfono", value: (p) => p.telefono ?? "", width: 16 },
        { header: "Compras del mes", value: (p) => p.cantidad, width: 14 },
        { header: "Total del mes", value: (p) => p.total, width: 16 },
        { header: "Última compra", value: (p) => (p.ultima_compra ? new Date(p.ultima_compra) : ""), width: 20 },
      ]),
      sheetFromRows("Compras por proveedor", conCompras, [
        { header: "Proveedor", value: (p) => p.nombre, width: 32 },
        { header: "Compras del mes", value: (p) => p.cantidad, width: 14 },
        { header: "Total del mes", value: (p) => p.total, width: 16 },
        { header: "Última compra", value: (p) => (p.ultima_compra ? new Date(p.ultima_compra) : ""), width: 20 },
      ]),
    ]);
    return new Response(new Uint8Array(buf), { status: 200, headers: xlsxResponseHeaders(`proveedores-${mes}`) });
  } catch (err) {
    console.error("[/api/reportes/proveedores/export]", err instanceof Error ? err.message : err);
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
}
