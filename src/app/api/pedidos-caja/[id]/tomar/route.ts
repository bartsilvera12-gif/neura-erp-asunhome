import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * POST /api/pedidos-caja/[id]/tomar
 *
 * Transiciona pedido de 'pendiente' -> 'en_caja' y estampa quien lo abrio.
 * Se invoca cuando el cajero clickea 'Cobrar' desde el listado. Best-effort:
 * si ya esta en_caja por otro cajero, devuelve OK (sin sobreescribir el
 * abierto_por para evitar disputas — el primer cajero queda como dueño).
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

    // Solo transicionar si esta pendiente. El WHERE estado='pendiente' es la
    // proteccion atomica.
    const upd = await sb
      .from("pedidos_caja")
      .update({
        estado: "en_caja",
        abierto_por_id: auth.usuarioCatalogId ?? null,
        abierto_por_email: auth.user?.email ?? null,
        abierto_at: new Date().toISOString(),
      })
      .eq("empresa_id", auth.empresa_id)
      .eq("id", id)
      .eq("estado", "pendiente");
    if (upd.error) return NextResponse.json(errorResponse(upd.error.message), { status: 400 });

    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo tomar el pedido.";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
