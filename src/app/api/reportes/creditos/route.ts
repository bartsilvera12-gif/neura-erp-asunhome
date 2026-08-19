import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getCreditosReporte } from "@/lib/reportes/server/creditos-pg";

/** GET /api/reportes/creditos — clientes con ventas a crédito + saldos. */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const data = await getCreditosReporte(schema, ctx.auth.empresa_id);
    return NextResponse.json(successResponse(data));
  } catch (err) {
    console.error("[/api/reportes/creditos]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el reporte de créditos."), { status: 500 });
  }
}
