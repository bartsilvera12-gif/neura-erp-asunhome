import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { convertirEnPedido } from "@/lib/presupuestos/server/presupuestos-pg";

/**
 * POST /api/presupuestos/[id]/convertir — convierte un presupuesto aprobado en un pedido
 * (proyecto tipo 'pedido', estado 'nuevo'). NO descuenta stock. Evita doble conversión.
 */
export async function POST(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const { pedido_id } = await convertirEnPedido(ctx.supabase, ctx.auth.empresa_id, id);
    return NextResponse.json(successResponse({ pedido_id }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo convertir el presupuesto.";
    const status = /ya fue convertido/i.test(msg)
      ? 409
      : /no encontrado|no configurado|solo se puede/i.test(msg)
      ? 400
      : 500;
    console.error("[/api/presupuestos/[id]/convertir]", msg);
    return NextResponse.json(errorResponse(msg), { status });
  }
}
