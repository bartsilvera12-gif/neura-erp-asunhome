import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  deleteReceta,
  getReceta,
  getRecetaCosteo,
  listRecetaItems,
  updateReceta,
} from "@/lib/recetas/recetas-pg";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteCtx) {
  try {
    const { id } = await params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const receta = await getReceta(ctx.supabase, ctx.auth.empresa_id, id);
    if (!receta) {
      return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    }
    const [items, costeo] = await Promise.all([
      listRecetaItems(ctx.supabase, id),
      getRecetaCosteo(ctx.supabase, id),
    ]);
    return NextResponse.json(successResponse({ receta, items, costeo }));
  } catch (err) {
    console.error("[/api/recetas/[id] GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar la receta."), { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteCtx) {
  try {
    const { id } = await params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (typeof body.nombre === "string" || body.nombre === null) patch.nombre = body.nombre;
    if (typeof body.rendimiento_cantidad === "number")
      patch.rendimiento_cantidad = body.rendimiento_cantidad;
    if (typeof body.rendimiento_unidad === "string" || body.rendimiento_unidad === null)
      patch.rendimiento_unidad = body.rendimiento_unidad;
    if (typeof body.notas === "string" || body.notas === null) patch.notas = body.notas;
    if (typeof body.activa === "boolean") patch.activa = body.activa;
    const row = await updateReceta(ctx.supabase, ctx.auth.empresa_id, id, patch);
    return NextResponse.json(successResponse({ receta: row }));
  } catch (err) {
    console.error("[/api/recetas/[id] PATCH]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo actualizar."), { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteCtx) {
  try {
    const { id } = await params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    await deleteReceta(ctx.supabase, ctx.auth.empresa_id, id);
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    console.error("[/api/recetas/[id] DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo eliminar."), { status: 500 });
  }
}
