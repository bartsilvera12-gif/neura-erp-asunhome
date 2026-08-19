import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { marcarLeida } from "@/lib/notificaciones/server";

/** POST /api/notificaciones/[id]/leer — marca una notificación como leída. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id } = await params;
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    await marcarLeida(schema, ctx.auth.empresa_id, id);
    return NextResponse.json(successResponse({ leida: true }));
  } catch (err) {
    console.error("[/api/notificaciones/[id]/leer]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo marcar la notificación."), { status: 500 });
  }
}
