import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { registrarCobro, CobroError } from "@/lib/cobros/server/cobros-pg";

/** POST /api/cobros — registra un cobro contra una cuenta por cobrar. */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const usuarioNombre = ctx.auth.nombre ?? ctx.auth.user?.email ?? null;
    const usuarioId = ctx.auth.user?.id ?? null;

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(errorResponse("JSON inválido."), { status: 400 });
    }

    const result = await registrarCobro(ctx.supabase, ctx.auth.empresa_id, {
      cuenta_por_cobrar_id: String(body.cuenta_por_cobrar_id ?? ""),
      monto: Number(body.monto),
      metodo_pago: (body.metodo_pago as "efectivo" | "transferencia" | "tarjeta" | "otro") ?? "efectivo",
      entidad_bancaria_id: body.entidad_bancaria_id ? String(body.entidad_bancaria_id) : null,
      entidad_nombre_snapshot: body.entidad_nombre_snapshot ? String(body.entidad_nombre_snapshot) : null,
      referencia: body.referencia ? String(body.referencia) : null,
      titular: body.titular ? String(body.titular) : null,
      observaciones: body.observaciones ? String(body.observaciones) : null,
      fecha_pago: typeof body.fecha_pago === "string" ? body.fecha_pago : null,
      usuario_id: usuarioId,
      usuario_nombre: usuarioNombre,
    });

    return NextResponse.json(successResponse(result));
  } catch (err) {
    if (err instanceof CobroError) {
      return NextResponse.json(errorResponse(err.message), { status: err.status });
    }
    console.error("[/api/cobros POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo registrar el cobro."), { status: 500 });
  }
}
