import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/planes/:id — un plan de la empresa (tenant + service role).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { supabase, auth } = ctx;
    const { id } = await params;
    if (!id || !uuidRe.test(id)) {
      return NextResponse.json(errorResponse("id inválido"), { status: 400 });
    }

    const { data, error } = await supabase
      .from("planes")
      .select("*")
      .eq("id", id)
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }
    if (!data) {
      return NextResponse.json(errorResponse("Plan no encontrado"), { status: 404 });
    }
    return NextResponse.json(successResponse(data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/**
 * PATCH /api/planes/:id
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { supabase, auth } = ctx;
    const { id } = await params;
    if (!id || !uuidRe.test(id)) {
      return NextResponse.json(errorResponse("id inválido"), { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};

    if (typeof body.nombre === "string") patch.nombre = body.nombre.trim();
    if (body.descripcion !== undefined) {
      patch.descripcion =
        typeof body.descripcion === "string" && body.descripcion.trim()
          ? body.descripcion.trim()
          : null;
    }
    if (body.precio !== undefined) {
      const precio =
        typeof body.precio === "number" ? body.precio : parseFloat(String(body.precio));
      if (!Number.isFinite(precio) || precio <= 0) {
        return NextResponse.json(errorResponse("El precio debe ser mayor a 0."), { status: 400 });
      }
      patch.precio = precio;
    }
    if (typeof body.moneda === "string") patch.moneda = body.moneda.trim().toUpperCase();
    if (typeof body.periodicidad === "string") patch.periodicidad = body.periodicidad.trim().toLowerCase();
    if (body.limite_usuarios !== undefined) {
      patch.limite_usuarios =
        body.limite_usuarios === null || body.limite_usuarios === ""
          ? null
          : parseInt(String(body.limite_usuarios), 10) || null;
    }
    if (body.limite_clientes !== undefined) {
      patch.limite_clientes =
        body.limite_clientes === null || body.limite_clientes === ""
          ? null
          : parseInt(String(body.limite_clientes), 10) || null;
    }
    if (body.limite_facturas !== undefined) {
      patch.limite_facturas =
        body.limite_facturas === null || body.limite_facturas === ""
          ? null
          : parseInt(String(body.limite_facturas), 10) || null;
    }
    if (typeof body.estado === "string") patch.estado = body.estado.trim().toLowerCase();
    if (typeof body.es_plan_marketing === "boolean") patch.es_plan_marketing = body.es_plan_marketing;
    if (body.plantilla_operativa !== undefined) patch.plantilla_operativa = body.plantilla_operativa;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(errorResponse("No hay campos para actualizar."), { status: 400 });
    }

    const { data, error } = await supabase
      .from("planes")
      .update(patch)
      .eq("id", id)
      .eq("empresa_id", auth.empresa_id)
      .select()
      .maybeSingle();

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }
    if (!data) {
      return NextResponse.json(errorResponse("Plan no encontrado"), { status: 404 });
    }
    return NextResponse.json(successResponse(data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/**
 * DELETE /api/planes/:id
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { supabase, auth } = ctx;
    const { id } = await params;
    if (!id || !uuidRe.test(id)) {
      return NextResponse.json(errorResponse("id inválido"), { status: 400 });
    }

    const { data: deletedRows, error } = await supabase
      .from("planes")
      .delete()
      .eq("id", id)
      .eq("empresa_id", auth.empresa_id)
      .select("id");

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }
    if (!deletedRows?.length) {
      return NextResponse.json(errorResponse("Plan no encontrado"), { status: 404 });
    }
    return NextResponse.json(successResponse({ deleted: true }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
