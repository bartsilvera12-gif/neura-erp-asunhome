import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * POST /api/presupuestos/[id]/marcar-convertido
 *
 * Marca un presupuesto aprobado como 'convertido' apuntando a la venta que
 * lo cobró. Usa la columna existente `convertido_pedido_id` para guardar el
 * `venta_id` (semántica bendecida para Ferrecolor: convertido a venta, no a
 * pedido).
 *
 * Body: { venta_id: string }
 */
export async function POST(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const ventaId = body.venta_id != null ? String(body.venta_id) : null;
    if (!ventaId) {
      return NextResponse.json(errorResponse("venta_id es obligatorio."), { status: 400 });
    }

    const { error } = await ctx.supabase
      .from("presupuestos")
      .update({
        estado: "convertido",
        convertido_pedido_id: ventaId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("empresa_id", ctx.auth.empresa_id)
      .neq("estado", "convertido"); // idempotente
    if (error) throw new Error(error.message);

    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo marcar convertido.";
    console.error("[/api/presupuestos/[id]/marcar-convertido]", msg);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
