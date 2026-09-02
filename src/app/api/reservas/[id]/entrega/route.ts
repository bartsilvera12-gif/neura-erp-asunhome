/** POST /api/reservas/[id]/entrega — retiro parcial: marca cantidad entregada de un ítem. */
import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { marcarEntrega } from "@/lib/reservas/server/reservas-pg";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    await params; // reserva id no necesario (el ítem lleva su reserva)
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const itemId = b.reserva_item_id != null ? String(b.reserva_item_id) : "";
    if (!itemId) return NextResponse.json(errorResponse("Falta el ítem."), { status: 400 });
    await marcarEntrega(schema, ctx.auth.empresa_id, itemId, Number(b.cantidad));
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo registrar la entrega.";
    console.error("[/api/reservas/[id]/entrega POST]", msg);
    return NextResponse.json(errorResponse(msg), { status: /mayor a 0|Falta/i.test(msg) ? 400 : 500 });
  }
}
