import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/middleware/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getClientesSupabaseFromAuthWithRol } from "@/lib/clientes/clientes-service-client";
import { contarClientesPorSlug, ensureSemillasCatalogoTipos, normalizeSlug } from "@/lib/clientes/tipo-servicio-catalogo";

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PUT { nombre?: string, activo?: boolean, orden?: number } — admin. No se puede cambiar slug; sistema no elimina.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getClientesSupabaseFromAuthWithRol(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    if (!isAdmin(ctx.auth)) {
      return NextResponse.json(errorResponse("Sólo administradores"), { status: 403 });
    }
    const { supabase, auth } = ctx;
    const { id: rowId } = await params;
    if (!rowId || !uuidRe.test(rowId)) {
      return NextResponse.json(errorResponse("id inválido"), { status: 400 });
    }
    await ensureSemillasCatalogoTipos(supabase, auth.empresa_id);

    const { data: row, error: err0 } = await supabase
      .from("cliente_tipos_servicio_catalogo")
      .select("id, slug, es_sistema")
      .eq("id", rowId)
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();
    if (err0 || !row) {
      return NextResponse.json(errorResponse("Registro no encontrado"), { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const patch: Record<string, unknown> = {};

    if (typeof body.nombre === "string") {
      const t = body.nombre.trim();
      if (!t || t.length > 200) {
        return NextResponse.json(errorResponse("nombre inválido"), { status: 400 });
      }
      patch.nombre = t;
    }
    if (typeof body.activo === "boolean") {
      patch.activo = body.activo;
    }
    // `JSON.stringify` convierte `NaN` en `null`; no tratarlo como "orden=0" ni fallar.
    if (body.orden !== undefined && body.orden !== null) {
      if (typeof body.orden === "number" && Number.isFinite(body.orden)) {
        patch.orden = Math.max(0, Math.min(32_000, Math.trunc(body.orden)));
      } else {
        return NextResponse.json(errorResponse("orden inválido"), { status: 400 });
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(errorResponse("Nada que actualizar"), { status: 400 });
    }

    const { data, error } = await supabase
      .from("cliente_tipos_servicio_catalogo")
      .update(patch)
      .eq("id", rowId)
      .eq("empresa_id", auth.empresa_id)
      .select("id, empresa_id, slug, nombre, activo, orden, es_sistema, created_at, updated_at")
      .maybeSingle();
    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }
    if (data == null) {
      return NextResponse.json(
        errorResponse("No se actualizó ninguna fila (revisá permisos, empresa o id)."),
        { status: 400 }
      );
    }
    return NextResponse.json(successResponse(data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/**
 * DELETE — admin; sólo tipos no-sistema, sin clientes con ese slug.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getClientesSupabaseFromAuthWithRol(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    if (!isAdmin(ctx.auth)) {
      return NextResponse.json(errorResponse("Sólo administradores"), { status: 403 });
    }
    const { supabase, auth } = ctx;
    const { id: rowId } = await params;
    if (!rowId || !uuidRe.test(rowId)) {
      return NextResponse.json(errorResponse("id inválido"), { status: 400 });
    }
    const { data: row, error: e0 } = await supabase
      .from("cliente_tipos_servicio_catalogo")
      .select("id, slug, es_sistema")
      .eq("id", rowId)
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();
    if (e0 || !row) {
      return NextResponse.json(errorResponse("Registro no encontrado"), { status: 404 });
    }
    if ((row as { es_sistema?: boolean }).es_sistema) {
      return NextResponse.json(
        errorResponse("Los tipos predefinidos no se eliminan. Podés desactivarlos."),
        { status: 400 }
      );
    }
    const slug = normalizeSlug((row as { slug: string }).slug);
    const usos = await contarClientesPorSlug(supabase, auth.empresa_id, slug);
    if (usos > 0) {
      return NextResponse.json(
        errorResponse("Hay clientes con este segmento. Desactivalo o reasigná los clientes antes de borrar."),
        { status: 400 }
      );
    }
    const { error } = await supabase
      .from("cliente_tipos_servicio_catalogo")
      .delete()
      .eq("id", rowId)
      .eq("empresa_id", auth.empresa_id);
    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
