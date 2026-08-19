import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * POST /api/pedidos-caja/[id]/liberar
 *
 * Saca el pedido de la cola de Caja: en_cola_caja -> false y estado ->
 * 'pendiente'. El pedido vuelve al vendedor (editable) y deja de aparecer en
 * "Pedidos por cobrar" hasta que lo re-envíen con /enviar-a-caja. Limpia
 * abierto_por*. Solo aplica a pedidos no facturados/cancelados.
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
      .update({
        estado: "pendiente",
        en_cola_caja: false,
        abierto_por_id: null,
        abierto_por_email: null,
        abierto_at: null,
      })
      .eq("empresa_id", auth.empresa_id)
      .eq("id", id)
      .in("estado", ["pendiente", "en_caja"]);
    if (upd.error) return NextResponse.json(errorResponse(upd.error.message), { status: 400 });

    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo liberar el pedido.";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
