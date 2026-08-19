import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { cancelarOrdenCompra } from "@/lib/ordenes-compra/server/ordenes-compra-pg";

/** POST /api/ordenes-compra/[numero]/cancelar — anula una OC abierta. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ numero: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { numero } = await params;
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const motivo = body.motivo != null ? String(body.motivo) : null;

    const n = await cancelarOrdenCompra(schema, ctx.auth.empresa_id, decodeURIComponent(numero), motivo);
    if (n === 0)
      return NextResponse.json(
        errorResponse("La orden no está abierta (ya fue recibida o cancelada)."),
        { status: 409 }
      );
    return NextResponse.json(successResponse({ cancelada: true }));
  } catch (err) {
    console.error("[/api/ordenes-compra/[numero]/cancelar]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cancelar la orden de compra."), { status: 500 });
  }
}
