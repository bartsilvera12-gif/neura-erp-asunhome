import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { mergeCouponNumberingFromUnknown } from "@/lib/sorteos/coupon-numbering-api";

/**
 * GET /api/sorteos/:id
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
    const { id } = await params;
    const empresaId = ctx.auth.empresa_id;
    const sb = await getChatServiceClientForEmpresa(empresaId);
    const { data, error } = await sb
      .from("sorteos")
      .select("*")
      .eq("id", id)
      .eq("empresa_id", empresaId)
      .maybeSingle();

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }
    if (!data) {
      return NextResponse.json(errorResponse("Sorteo no encontrado"), { status: 404 });
    }
    return NextResponse.json(successResponse(data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/**
 * PATCH /api/sorteos/:id
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
    const { id } = await params;
    const empresaId = ctx.auth.empresa_id;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const patch: Record<string, unknown> = {};
    if (typeof body.nombre === "string") patch.nombre = body.nombre.trim();
    if (body.descripcion !== undefined) {
      patch.descripcion =
        typeof body.descripcion === "string" && body.descripcion.trim()
          ? body.descripcion.trim()
          : null;
    }
    if (body.precio_por_boleto !== undefined) {
      patch.precio_por_boleto =
        typeof body.precio_por_boleto === "number"
          ? body.precio_por_boleto
          : Number(body.precio_por_boleto) || 0;
    }
    if (body.max_boletos !== undefined) {
      patch.max_boletos =
        typeof body.max_boletos === "number" ? body.max_boletos : Number(body.max_boletos) || 0;
    }
    if (body.fecha_sorteo !== undefined) {
      patch.fecha_sorteo =
        typeof body.fecha_sorteo === "string" && body.fecha_sorteo.trim()
          ? body.fecha_sorteo.trim()
          : null;
    }
    if (typeof body.estado === "string") patch.estado = body.estado.trim();
    if (body.datos_bancarios !== undefined && typeof body.datos_bancarios === "object") {
      patch.datos_bancarios = body.datos_bancarios;
    }
    if (body.imagen_url !== undefined) {
      patch.imagen_url =
        typeof body.imagen_url === "string" && body.imagen_url.trim()
          ? body.imagen_url.trim()
          : null;
    }
    if (typeof body.ticket_delivery_mode === "string") {
      const m = body.ticket_delivery_mode.trim();
      if (["text_only", "text_and_image", "image_only"].includes(m)) {
        patch.ticket_delivery_mode = m;
      }
    }
    if (body.ticket_image_config !== undefined && typeof body.ticket_image_config === "object") {
      patch.ticket_image_config = body.ticket_image_config;
    }
    if ("coupon_numbering_enabled" in body) {
      const numbering = mergeCouponNumberingFromUnknown(body as Record<string, unknown>);
      if ("error" in numbering) {
        return NextResponse.json(errorResponse(numbering.error), { status: 400 });
      }
      Object.assign(patch, numbering);
    }

    const sb = await getChatServiceClientForEmpresa(empresaId);
    const { data, error } = await sb
      .from("sorteos")
      .update(patch)
      .eq("id", id)
      .eq("empresa_id", empresaId)
      .select("*")
      .maybeSingle();

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }
    if (!data) {
      return NextResponse.json(errorResponse("Sorteo no encontrado"), { status: 404 });
    }
    return NextResponse.json(successResponse(data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
