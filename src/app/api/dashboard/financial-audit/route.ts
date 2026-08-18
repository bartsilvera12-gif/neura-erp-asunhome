import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { enRangoCalendario, rangoMesCalendarioLocal, toCalendarDateStr } from "@/lib/fechas/calendario";
import { esFacturaAnulada, esFacturaCorregidaNc } from "@/lib/dashboard/data";

type Periodo = "hoy" | "7d" | "30d" | "mes" | "anio";

function rangoPeriodo(periodo: Periodo): { desde: Date; hasta: Date } {
  const ahora = new Date();
  switch (periodo) {
    case "mes":
      return rangoMesCalendarioLocal(ahora);
    case "hoy": {
      const desde = new Date(ahora);
      desde.setHours(0, 0, 0, 0);
      const hasta = new Date(ahora);
      hasta.setHours(23, 59, 59, 999);
      return { desde, hasta };
    }
    case "7d": {
      const hasta = new Date(ahora);
      hasta.setHours(23, 59, 59, 999);
      const desde = new Date(ahora);
      desde.setDate(desde.getDate() - 7);
      desde.setHours(0, 0, 0, 0);
      return { desde, hasta };
    }
    case "30d": {
      const hasta = new Date(ahora);
      hasta.setHours(23, 59, 59, 999);
      const desde = new Date(ahora);
      desde.setDate(desde.getDate() - 30);
      desde.setHours(0, 0, 0, 0);
      return { desde, hasta };
    }
    case "anio": {
      const desde = new Date(ahora.getFullYear(), 0, 1, 0, 0, 0, 0);
      const hasta = new Date(ahora.getFullYear(), 11, 31, 23, 59, 59, 999);
      return { desde, hasta };
    }
    default:
      return rangoMesCalendarioLocal(ahora);
  }
}

function toNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * GET /api/dashboard/financial-audit?periodo=mes
 * Auditoría real: misma empresa/schema que tenant-tables, mismos filtros de período que el dashboard.
 * Requiere sesión (mismo auth que /api/dashboard/tenant-tables).
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;
    const empresaId = auth.empresa_id;

    const raw = request.nextUrl.searchParams.get("periodo") ?? "mes";
    const periodo = (["hoy", "7d", "30d", "mes", "anio"].includes(raw) ? raw : "mes") as Periodo;
    const { desde, hasta } = rangoPeriodo(periodo);

    const dataSchema = await fetchDataSchemaForEmpresaId(empresaId);

    const [facturasQ, pagosQ] = await Promise.all([
      supabase.from("facturas").select("*").eq("empresa_id", empresaId),
      supabase.from("pagos").select("id, factura_id, monto, fecha_pago").eq("empresa_id", empresaId),
    ]);

    const facturasErr = facturasQ.error?.message ?? null;
    const pagosErr = pagosQ.error?.message ?? null;
    const facturasRows = (facturasQ.data ?? []) as Record<string, unknown>[];
    const pagosRows = (pagosQ.data ?? []) as Record<string, unknown>[];

    const facturasValidas = facturasRows.filter((r) => !esFacturaAnulada(r.estado as string));
    const enPeriodo = (fecha: unknown) =>
      enRangoCalendario(toCalendarDateStr(fecha as string), desde, hasta);

    const facturasPeriodo = facturasValidas.filter((r) => enPeriodo(r.fecha));
    const sumFacturas = facturasPeriodo.reduce((s, r) => s + toNum(r.monto), 0);

    const pagosPeriodo = pagosRows.filter((p) => enPeriodo(p.fecha_pago));
    const sumPagos = pagosPeriodo.reduce((s, p) => s + toNum(p.monto), 0);

    const montoPorFactura = new Map<string, number>();
    for (const p of pagosRows) {
      const fid = String(p.factura_id ?? "");
      if (!fid) continue;
      montoPorFactura.set(fid, (montoPorFactura.get(fid) ?? 0) + toNum(p.monto));
    }

    const contadoEnPeriodo = facturasPeriodo.filter(
      (r) =>
        String(r.tipo ?? "").toLowerCase() === "contado" &&
        !esFacturaAnulada(r.estado as string) &&
        !esFacturaCorregidaNc(r.estado as string)
    );
    const imputadas = contadoEnPeriodo.filter((r) => (montoPorFactura.get(String(r.id)) ?? 0) === 0);
    const sumImputado = imputadas.reduce((s, r) => s + toNum(r.monto), 0);

    return NextResponse.json(
      successResponse({
        empresa_id: empresaId,
        data_schema: dataSchema,
        periodo,
        rango: {
          desde_cal: `${desde.getFullYear()}-${String(desde.getMonth() + 1).padStart(2, "0")}-${String(desde.getDate()).padStart(2, "0")}`,
          hasta_cal: `${hasta.getFullYear()}-${String(hasta.getMonth() + 1).padStart(2, "0")}-${String(hasta.getDate()).padStart(2, "0")}`,
        },
        errores_postgrest: {
          facturas: facturasErr,
          pagos: pagosErr,
        },
        facturas: {
          filas_totales_tabla: facturasRows.length,
          no_anuladas: facturasValidas.length,
          en_periodo_por_fecha_emision: facturasPeriodo.length,
          suma_monto_en_periodo: sumFacturas,
          en_periodo_tipo_contado: contadoEnPeriodo.length,
          contado_sin_filas_pagos_imputadas: imputadas.length,
          suma_monto_imputado_contado: sumImputado,
        },
        pagos: {
          filas_totales_tabla: pagosRows.length,
          en_periodo_por_fecha_pago: pagosPeriodo.length,
          suma_monto_en_periodo: sumPagos,
        },
        dashboard_frontend_cobrado_esperado: sumPagos + sumImputado,
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
