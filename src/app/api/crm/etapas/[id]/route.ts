import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { isAdmin } from "@/lib/middleware/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PUT /api/crm/etapas/:id — actualizar etapa (admin).
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    if (!isAdmin(ctx.auth)) {
      return NextResponse.json(errorResponse("Sólo administradores"), { status: 403 });
    }
    const { id } = await params;
    if (!id || !uuidRe.test(id)) {
      return NextResponse.json(errorResponse("id inválido"), { status: 400 });
    }
    const { supabase, auth } = ctx;
    const body = (await request.json().catch(() => ({}))) as {
      nombre?: string;
      color?: string;
      orden?: number;
      activo?: boolean;
    };
    const patch: Record<string, unknown> = {};
    if (typeof body.nombre === "string") patch.nombre = body.nombre.trim();
    if (typeof body.color === "string") patch.color = body.color;
    if (body.orden !== undefined && Number.isFinite(body.orden as number)) {
      patch.orden = Math.trunc(body.orden as number);
    }
    if (typeof body.activo === "boolean") patch.activo = body.activo;
    if (Object.keys(patch).length === 0) {
      return NextResponse.json(errorResponse("Nada que actualizar"), { status: 400 });
    }
    const { data, error } = await supabase
      .from("crm_etapas")
      .update(patch)
      .eq("id", id)
      .eq("empresa_id", auth.empresa_id)
      .select()
      .single();
    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }
    if (!data) {
      return NextResponse.json(errorResponse("Etapa no encontrada"), { status: 404 });
    }
    return NextResponse.json(successResponse(data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/**
 * DELETE /api/crm/etapas/:id — eliminar etapa (admin).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    if (!isAdmin(ctx.auth)) {
      return NextResponse.json(errorResponse("Sólo administradores"), { status: 403 });
    }
    const { id } = await params;
    if (!id || !uuidRe.test(id)) {
      return NextResponse.json(errorResponse("id inválido"), { status: 400 });
    }
    const { supabase, auth } = ctx;
    const { error } = await supabase
      .from("crm_etapas")
      .delete()
      .eq("id", id)
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
