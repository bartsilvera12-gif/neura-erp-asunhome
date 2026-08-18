import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { insertReceta, listRecetas } from "@/lib/recetas/recetas-pg";

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const rows = await listRecetas(ctx.supabase, ctx.auth.empresa_id);
    return NextResponse.json(successResponse({ recetas: rows }));
  } catch (err) {
    console.error("[/api/recetas GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las recetas."), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const producto_id = typeof body.producto_id === "string" ? body.producto_id : null;
    if (!producto_id) {
      return NextResponse.json(errorResponse("producto_id es obligatorio."), { status: 400 });
    }
    const row = await insertReceta(ctx.supabase, ctx.auth.empresa_id, {
      producto_id,
      nombre: typeof body.nombre === "string" ? body.nombre : null,
      rendimiento_cantidad:
        typeof body.rendimiento_cantidad === "number" ? body.rendimiento_cantidad : 1,
      rendimiento_unidad:
        typeof body.rendimiento_unidad === "string" ? body.rendimiento_unidad : null,
      notas: typeof body.notas === "string" ? body.notas : null,
      activa: body.activa === false ? false : true,
    });
    return NextResponse.json(successResponse({ receta: row }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/recetas_empresa_producto_uq|duplicate/i.test(msg)) {
      return NextResponse.json(
        errorResponse("Ya existe una receta para ese producto."),
        { status: 409 }
      );
    }
    console.error("[/api/recetas POST]", msg);
    return NextResponse.json(errorResponse("No se pudo crear la receta."), { status: 500 });
  }
}
