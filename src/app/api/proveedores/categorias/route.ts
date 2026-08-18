import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  listProveedorCategorias,
  insertProveedorCategoria,
} from "@/lib/proveedores/server/proveedores-pg";
import { normalizeUpperText, normalizeUpperNullable } from "@/lib/text/normalize";

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const incluirInactivas = request.nextUrl.searchParams.get("todas") === "1";
    const rows = await listProveedorCategorias(schema, ctx.auth.empresa_id, {
      soloActivas: !incluirInactivas,
    });
    return NextResponse.json(successResponse({ categorias: rows }));
  } catch (err) {
    console.error("[/api/proveedores/categorias GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      errorResponse("No se pudieron cargar las categorías."),
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const nombre = normalizeUpperText(body.nombre);
    if (!nombre) {
      return NextResponse.json(errorResponse("El nombre es obligatorio."), { status: 400 });
    }
    const descripcion = normalizeUpperNullable(body.descripcion);
    const activo = body.activo === false ? false : true;

    try {
      const row = await insertProveedorCategoria(schema, ctx.auth.empresa_id, {
        nombre, descripcion, activo,
      });
      return NextResponse.json(successResponse({ categoria: row }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      const code = (e as { code?: string })?.code;
      if (code === "23505" || /unique|duplicate/i.test(msg)) {
        return NextResponse.json(
          errorResponse("Ya existe una categoría con ese nombre."),
          { status: 409 }
        );
      }
      console.error("[/api/proveedores/categorias POST]", { schema, msg, code });
      return NextResponse.json(
        errorResponse("No se pudo guardar la categoría. Revisá los datos e intentá nuevamente."),
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("[/api/proveedores/categorias POST] outer", err);
    return NextResponse.json(errorResponse("No se pudo guardar la categoría."), { status: 500 });
  }
}
