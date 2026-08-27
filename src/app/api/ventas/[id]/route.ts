/**
 * PATCH /api/ventas/[id] — editar SOLO datos de la venta, nunca productos,
 * montos ni método de pago (eso afectaría stock y caja). Campos permitidos:
 * cliente, observaciones y fecha.
 */
import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

export async function PATCH(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id: ventaId } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const sb = ctx.supabase;
    const empresaId = ctx.auth.empresa_id;

    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    // Traer la venta y bloquear la edición si está anulada.
    const { data: venta, error: eV } = await sb
      .from("ventas")
      .select("id, estado")
      .eq("id", ventaId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (eV) throw new Error(eV.message);
    if (!venta) return NextResponse.json(errorResponse("Venta no encontrada."), { status: 404 });
    if (venta.estado === "anulada") {
      return NextResponse.json(errorResponse("No se puede editar una venta anulada."), { status: 409 });
    }

    // Solo campos seguros.
    const patch: Record<string, unknown> = {};
    if (b.cliente_id !== undefined) {
      patch.cliente_id = b.cliente_id === null || b.cliente_id === "" ? null : String(b.cliente_id);
    }
    if (b.observaciones !== undefined) {
      patch.observaciones = b.observaciones === null ? null : String(b.observaciones).slice(0, 4000);
    }
    if (b.fecha !== undefined && b.fecha) {
      const d = new Date(String(b.fecha));
      if (!Number.isNaN(d.getTime())) patch.fecha = d.toISOString();
    }
    // Vendedor acreditado para comisión (no toca stock/caja, solo el crédito de la venta).
    if (b.vendedor_id !== undefined) {
      patch.vendedor_id = b.vendedor_id === null || b.vendedor_id === "" ? null : String(b.vendedor_id);
      patch.vendedor_nombre = b.vendedor_nombre != null && String(b.vendedor_nombre).trim()
        ? String(b.vendedor_nombre).slice(0, 200) : null;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json(errorResponse("No hay cambios para guardar."), { status: 400 });
    }
    patch.updated_at = new Date().toISOString();

    const { error: eU } = await sb
      .from("ventas")
      .update(patch)
      .eq("id", ventaId)
      .eq("empresa_id", empresaId);
    if (eU) throw new Error(eU.message);

    return NextResponse.json(successResponse({ id: ventaId }));
  } catch (err) {
    console.error("[/api/ventas/[id] PATCH]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo editar la venta."), { status: 500 });
  }
}
