import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getDetalleCaja } from "@/lib/caja/server";

/** GET /api/reportes/cajas/[id] — detalle de un turno (ventas + movimientos). */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const { id } = await params;
    if (!id) return NextResponse.json(errorResponse("id obligatorio."), { status: 400 });

    const data = await getDetalleCaja(ctx.supabase, ctx.auth.empresa_id, id);
    if (!data) return NextResponse.json(errorResponse("Caja no encontrada."), { status: 404 });

    return NextResponse.json(successResponse(data));
  } catch (err) {
    console.error("[/api/reportes/cajas/[id]]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el detalle de la caja."), { status: 500 });
  }
}
