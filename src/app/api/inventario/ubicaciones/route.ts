import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { listUbicaciones, insertUbicacion } from "@/lib/inventario/server/catalogos-pg";
import { normalizeUpperText, normalizeUpperNullable } from "@/lib/text/normalize";

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const url = new URL(request.url);
    const todas = url.searchParams.get("todas") === "1";
    const rows = await listUbicaciones(schema, ctx.auth.empresa_id, { soloActivas: !todas });
    return NextResponse.json(successResponse({ ubicaciones: rows }));
  } catch (err) {
    console.error("[/api/inventario/ubicaciones GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las ubicaciones."), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const nombre = normalizeUpperText(body.nombre);
    if (!nombre) return NextResponse.json(errorResponse("El nombre es obligatorio."), { status: 400 });
    try {
      const row = await insertUbicacion(schema, ctx.auth.empresa_id, {
        nombre,
        codigo: normalizeUpperNullable(body.codigo),
        tipo: body.tipo == null ? "deposito" : String(body.tipo),
        parent_id: body.parent_id == null ? null : String(body.parent_id),
        descripcion: normalizeUpperNullable(body.descripcion),
        activo: body.activo === false ? false : true,
      });
      return NextResponse.json(successResponse({ ubicacion: row }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (/uq_ubicaciones_empresa_codigo|duplicate/i.test(msg)) {
        return NextResponse.json(
          errorResponse("Ya existe una ubicación con ese código."),
          { status: 409 }
        );
      }
      console.error("[/api/inventario/ubicaciones POST]", { schema, msg });
      return NextResponse.json(errorResponse("No se pudo crear la ubicación."), { status: 500 });
    }
  } catch (err) {
    console.error("[/api/inventario/ubicaciones POST] outer", err);
    return NextResponse.json(errorResponse("No se pudo crear la ubicación."), { status: 500 });
  }
}
