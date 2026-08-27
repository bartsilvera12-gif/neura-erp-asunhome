/**
 * GET /api/comisiones/reporte?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 * Comisión = % del total de ventas por vendedor en el período (ver lib/comisiones/reporte).
 */
import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { computeReporteComisiones } from "@/lib/comisiones/reporte";

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse("No autenticado"), { status: 401 });
    const sp = request.nextUrl.searchParams;
    const desde = sp.get("desde") || "";
    const hasta = sp.get("hasta") || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
      return NextResponse.json(errorResponse("Faltan desde/hasta (YYYY-MM-DD)."), { status: 400 });
    }
    const data = await computeReporteComisiones(ctx.supabase, ctx.auth.empresa_id, desde, hasta);
    return NextResponse.json(successResponse(data));
  } catch (err) {
    console.error("[/api/comisiones/reporte GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron calcular las comisiones."), { status: 500 });
  }
}
