import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * POST /api/reportes/conciliacion/movimiento
 * Body: { tipo: 'venta'|'cobro', id, estado: 'pendiente'|'aprobado'|'rechazado' }
 * Marca el estado de conciliación de un movimiento. NO toca stock, deuda ni montos.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(errorResponse("JSON inválido."), { status: 400 });
    }

    const tipo = body.tipo === "cobro" ? "cobro" : body.tipo === "venta" ? "venta" : null;
    const id = body.id ? String(body.id) : "";
    const estado = body.estado;
    if (!tipo) return NextResponse.json(errorResponse("tipo inválido (venta|cobro)."), { status: 400 });
    if (!id) return NextResponse.json(errorResponse("id obligatorio."), { status: 400 });
    if (estado !== "pendiente" && estado !== "aprobado" && estado !== "rechazado") {
      return NextResponse.json(errorResponse("estado inválido."), { status: 400 });
    }

    const tabla = tipo === "cobro" ? "cobros_clientes" : "ventas_pagos_detalle";
    const quienNombre = ctx.auth.nombre ?? ctx.auth.user?.email ?? null;
    const patch: Record<string, unknown> = {
      conciliacion_estado: estado,
      conciliado_at: estado === "pendiente" ? null : new Date().toISOString(),
      conciliado_por: estado === "pendiente" ? null : quienNombre,
    };

    const upd = await ctx.supabase
      .from(tabla)
      .update(patch)
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (upd.error) throw new Error(upd.error.message);
    if (!upd.data) return NextResponse.json(errorResponse("Movimiento no encontrado."), { status: 404 });

    return NextResponse.json(successResponse({ id, tipo, estado }));
  } catch (err) {
    console.error("[/api/reportes/conciliacion/movimiento]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo actualizar la conciliación."), { status: 500 });
  }
}
