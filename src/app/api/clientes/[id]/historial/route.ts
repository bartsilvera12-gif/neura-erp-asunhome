import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

const MAX_ROWS = 200;

/**
 * GET /api/clientes/:id/historial
 * Listado de auditoría (`cliente_historial`) para un cliente.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(_request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { id: clienteId } = await params;
    if (!clienteId) {
      return NextResponse.json(errorResponse("id es obligatorio"), { status: 400 });
    }

    const { data: cli } = await ctx.supabase
      .from("clientes")
      .select("id, empresa_id")
      .eq("id", clienteId)
      .eq("empresa_id", ctx.auth.empresa_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!cli) {
      return NextResponse.json(errorResponse("Cliente no encontrado"), { status: 404 });
    }

    const { data: rows, error } = await ctx.supabase
      .from("cliente_historial")
      .select(
        "id, created_at, tipo, accion, plan_anterior_nombre, plan_nuevo_nombre, modo, factura_id, plan_pendiente_vigente_desde, creado_por_email, creado_por_auth_user_id, detalle"
      )
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("cliente_id", clienteId)
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS);

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 500 });
    }

    return NextResponse.json(successResponse({ filas: rows ?? [] }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al cargar historial";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
