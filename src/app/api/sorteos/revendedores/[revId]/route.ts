import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * PATCH /api/sorteos/revendedores/:revId — actualizar revendedor (campos parciales o solo activo).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ revId: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const empresaId = ctx.auth.empresa_id;
    const { revId } = await params;
    const id = revId.trim();
    if (!id) {
      return NextResponse.json(errorResponse("Revendedor inválido."), { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};

    if ("nombre" in body) {
      if (typeof body.nombre !== "string" || !body.nombre.trim()) {
        return NextResponse.json(errorResponse("El nombre es obligatorio."), { status: 400 });
      }
      patch.nombre = body.nombre.trim();
    }
    if ("telefono" in body) {
      patch.telefono =
        typeof body.telefono === "string" && body.telefono.trim() ? body.telefono.trim() : null;
    }
    if ("codigo_referido" in body) {
      if (typeof body.codigo_referido !== "string" || !body.codigo_referido.trim()) {
        return NextResponse.json(errorResponse("El código de referido es obligatorio."), { status: 400 });
      }
      const c = body.codigo_referido.trim();
      if (c.length > 48) {
        return NextResponse.json(errorResponse("El código no puede superar 48 caracteres."), { status: 400 });
      }
      patch.codigo_referido = c;
    }
    if ("activo" in body && typeof body.activo === "boolean") {
      patch.activo = body.activo;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(errorResponse("Sin cambios."), { status: 400 });
    }
    patch.updated_at = new Date().toISOString();

    const sb = await getChatServiceClientForEmpresa(empresaId);
    const { data, error } = await sb
      .from("sorteo_revendedores")
      .update(patch)
      .eq("id", id)
      .eq("empresa_id", empresaId)
      .select("*")
      .maybeSingle();

    if (error) {
      const status = (error as { code?: string }).code === "23505" ? 409 : 400;
      return NextResponse.json(errorResponse(error.message), { status });
    }
    if (!data) {
      return NextResponse.json(errorResponse("Revendedor no encontrado."), { status: 404 });
    }
    return NextResponse.json(successResponse(data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
