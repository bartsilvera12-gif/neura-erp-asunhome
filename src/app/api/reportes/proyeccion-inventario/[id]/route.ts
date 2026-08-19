import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getProyeccionProducto } from "@/lib/reportes/server/proyeccion-inventario-pg";
import { ultimosDiasBounds } from "@/lib/reportes/proyeccion-bounds";

/** GET /api/reportes/proyeccion-inventario/[id]?dias=30|60|90 — proyección de un producto. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id } = await params;
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const b = ultimosDiasBounds(parseInt(new URL(request.url).searchParams.get("dias") ?? "30", 10));

    const data = await getProyeccionProducto(schema, ctx.auth.empresa_id, id, b);
    if (!data) return NextResponse.json(errorResponse("Producto no encontrado."), { status: 404 });
    return NextResponse.json(successResponse(data));
  } catch (err) {
    console.error("[/api/reportes/proyeccion-inventario/[id]]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo calcular la proyección."), { status: 500 });
  }
}
