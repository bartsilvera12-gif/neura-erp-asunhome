import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { deleteRecetaItem, updateRecetaItem } from "@/lib/recetas/recetas-pg";

type RouteCtx = { params: Promise<{ id: string; itemId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteCtx) {
  try {
    const { itemId } = await params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (typeof body.cantidad === "number" && body.cantidad > 0) patch.cantidad = body.cantidad;
    if (typeof body.unidad_medida === "string" || body.unidad_medida === null)
      patch.unidad_medida = body.unidad_medida;
    if (typeof body.merma_pct === "number" && body.merma_pct >= 0 && body.merma_pct < 1)
      patch.merma_pct = body.merma_pct;
    if (typeof body.orden === "number") patch.orden = body.orden;
    const row = await updateRecetaItem(ctx.supabase, itemId, patch);
    return NextResponse.json(successResponse({ item: row }));
  } catch (err) {
    console.error("[/api/recetas/[id]/items/[itemId] PATCH]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo actualizar el item."), { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteCtx) {
  try {
    const { itemId } = await params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    await deleteRecetaItem(ctx.supabase, itemId);
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    console.error("[/api/recetas/[id]/items/[itemId] DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo eliminar el item."), { status: 500 });
  }
}
