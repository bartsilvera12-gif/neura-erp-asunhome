import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { updateProveedorCategoria } from "@/lib/proveedores/server/proveedores-pg";
import { normalizeUpperText, normalizeUpperNullable } from "@/lib/text/normalize";

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const tenant = await getTenantSupabaseFromAuth(request);
    if (!tenant) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(tenant.auth.empresa_id);
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const patch: Parameters<typeof updateProveedorCategoria>[3] = {};
    if (body.nombre !== undefined) {
      const n = normalizeUpperText(body.nombre);
      if (!n) {
        return NextResponse.json(errorResponse("El nombre no puede quedar vacío."), { status: 400 });
      }
      patch.nombre = n;
    }
    if (body.descripcion !== undefined) patch.descripcion = normalizeUpperNullable(body.descripcion);
    if (body.activo !== undefined) patch.activo = Boolean(body.activo);

    try {
      const row = await updateProveedorCategoria(schema, tenant.auth.empresa_id, id, patch);
      if (!row) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
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
      console.error("[/api/proveedores/categorias/[id] PATCH]", { schema, id, msg, code });
      return NextResponse.json(
        errorResponse("No se pudo actualizar la categoría."),
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("[/api/proveedores/categorias/[id] PATCH] outer", err);
    return NextResponse.json(errorResponse("No se pudo actualizar la categoría."), { status: 500 });
  }
}
