import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getReporteCajas } from "@/lib/caja/server";
import { resolverRangoCajas } from "@/lib/caja/reporte-rango";

/** GET /api/reportes/cajas?desde=YYYY-MM-DD&hasta=YYYY-MM-DD */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const sp = new URL(request.url).searchParams;
    const rango = resolverRangoCajas(sp.get("desde"), sp.get("hasta"));

    const data = await getReporteCajas(ctx.supabase, ctx.auth.empresa_id, rango);
    return NextResponse.json(successResponse(data));
  } catch (err) {
    console.error("[/api/reportes/cajas]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el reporte de caja."), { status: 500 });
  }
}
