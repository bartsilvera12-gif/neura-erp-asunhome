import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { listProductos, listProductosVendiblesSinReceta } from "@/lib/recetas/recetas-pg";

/**
 * Productos para el módulo Recetas.
 * ?filtro=vendibles-sin-receta  → vendibles que aún no tienen receta (usado en "Crear receta")
 * ?filtro=vendibles | insumos | todos
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const url = new URL(request.url);
    const filtro = url.searchParams.get("filtro") ?? "todos";

    if (filtro === "vendibles-sin-receta") {
      const rows = await listProductosVendiblesSinReceta(ctx.supabase, ctx.auth.empresa_id);
      return NextResponse.json(successResponse({ productos: rows }));
    }
    const f = filtro === "vendibles" || filtro === "insumos" ? filtro : "todos";
    const rows = await listProductos(ctx.supabase, ctx.auth.empresa_id, f);
    return NextResponse.json(successResponse({ productos: rows }));
  } catch (err) {
    console.error("[/api/recetas/productos GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar productos."), { status: 500 });
  }
}
