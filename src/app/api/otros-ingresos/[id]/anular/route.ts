import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { anularMovimiento } from "@/lib/caja/server";

/**
 * POST /api/otros-ingresos/[id]/anular
 *
 * Anulacion soft: setea anulado_at + auditoria. El movimiento no se borra
 * fisicamente — queda en la tabla pero excluido de computeResumen (no suma
 * a caja). Idempotente: si ya esta anulado devuelve OK sin sobreescribir.
 *
 * Solo se permite anular movimientos tipo='ingreso' (egresos/retiros/ajustes
 * tienen su propia vida desde el panel de Caja).
 *
 * Body: { motivo?: string }
 */
export async function POST(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const motivo =
      (body as { motivo?: unknown } | null)?.motivo == null
        ? null
        : String((body as { motivo: unknown }).motivo);

    await anularMovimiento(ctx.supabase, {
      empresaId: ctx.auth.empresa_id,
      movimientoId: id,
      usuarioId: ctx.auth.usuarioCatalogId ?? null,
      motivo,
    });
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo anular el ingreso.";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
