import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * POST /api/pedidos-caja/[id]/enviar-a-caja
 *
 * Vuelve a poner el pedido en la cola de Caja: en_cola_caja -> true (estado
 * 'pendiente'). Inverso de /liberar. Solo aplica a pedidos no
 * facturados/cancelados.
 */
export async function POST(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase: sb, auth } = ctx;

    const upd = await sb
      .from("pedidos_caja")
      .update({ estado: "pendiente", en_cola_caja: true })
      .eq("empresa_id", auth.empresa_id)
      .eq("id", id)
      .in("estado", ["pendiente", "en_caja"]);
    if (upd.error) return NextResponse.json(errorResponse(upd.error.message), { status: 400 });

    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo enviar el pedido a caja.";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
