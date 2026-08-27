import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getReporteDiario } from "@/lib/reportes/server/reportes-pg";

/** GET /api/reportes/diario?desde=YYYY-MM-DD&hasta=YYYY-MM-DD — ventas por día. */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const sp = new URL(request.url).searchParams;
    const data = await getReporteDiario(schema, ctx.auth.empresa_id, sp.get("desde") ?? "", sp.get("hasta") ?? "");
    return NextResponse.json(successResponse(data));
  } catch (err) {
    console.error("[/api/reportes/diario]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el reporte diario."), { status: 500 });
  }
}
