import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { marcarTodasLeidas } from "@/lib/notificaciones/server";

/** POST /api/notificaciones/leer-todas — marca todas como leídas. */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    await marcarTodasLeidas(schema, ctx.auth.empresa_id);
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    console.error("[/api/notificaciones/leer-todas]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo actualizar."), { status: 500 });
  }
}
