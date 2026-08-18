import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { insertRecetaItem } from "@/lib/recetas/recetas-pg";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteCtx) {
  try {
    const { id: recetaId } = await params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const insumo_producto_id =
      typeof body.insumo_producto_id === "string" ? body.insumo_producto_id : null;
    const cantidad = typeof body.cantidad === "number" ? body.cantidad : null;
    if (!insumo_producto_id || cantidad == null || cantidad <= 0) {
      return NextResponse.json(
        errorResponse("insumo_producto_id y cantidad>0 son obligatorios."),
        { status: 400 }
      );
    }
    const row = await insertRecetaItem(ctx.supabase, ctx.auth.empresa_id, recetaId, {
      insumo_producto_id,
      cantidad,
      unidad_medida: typeof body.unidad_medida === "string" ? body.unidad_medida : null,
      merma_pct: typeof body.merma_pct === "number" ? body.merma_pct : 0,
      orden: typeof body.orden === "number" ? body.orden : 0,
    });
    return NextResponse.json(successResponse({ item: row }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/receta_items_unicos|duplicate/i.test(msg)) {
      return NextResponse.json(
        errorResponse("Ese insumo ya está en la receta."),
        { status: 409 }
      );
    }
    console.error("[/api/recetas/[id]/items POST]", msg);
    return NextResponse.json(errorResponse("No se pudo agregar el insumo."), { status: 500 });
  }
}
