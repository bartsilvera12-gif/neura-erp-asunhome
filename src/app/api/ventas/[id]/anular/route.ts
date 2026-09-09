import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { anularVentaPg, AnularVentaError } from "@/lib/ventas/server/anular-venta-pg";

/**
 * POST /api/ventas/[id]/anular
 *
 * Anula una venta ACTIVA cuya caja esté ACTUALMENTE ABIERTA. Toda la reversión
 * (stock, movimientos, caja, CxC, series, estado de la venta) corre en UNA
 * transacción con SELECT ... FOR UPDATE sobre la venta (ver anularVentaPg), así
 * dos requests simultáneos no pueden devolver el stock dos veces: siempre 7.
 *
 * Body: { motivo?: string }
 *  - Idempotente: si la venta ya está ANULADA -> 409 (no reprocesa stock).
 *  - venta.caja_id debe apuntar a una caja 'abierta' (regla "solo actuales").
 */
export async function POST(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id: ventaId } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const motivoRaw = (body as { motivo?: unknown } | null)?.motivo;
    const motivo = motivoRaw == null ? null : String(motivoRaw).trim() || null;

    const empresaId = ctx.auth.empresa_id;
    const schema = await fetchDataSchemaForEmpresaId(empresaId);

    const result = await anularVentaPg(
      schema,
      empresaId,
      ventaId,
      {
        id: ctx.auth.usuarioCatalogId ?? null,
        nombre: ctx.auth.nombre ?? ctx.auth.user?.email ?? null,
      },
      motivo
    );

    return NextResponse.json(
      successResponse({
        ok: true,
        venta_id: result.ventaId,
        movimientos_revertidos: result.movimientosRevertidos,
      })
    );
  } catch (err) {
    if (err instanceof AnularVentaError) {
      const status =
        err.code === "venta_no_encontrada" ? 404 :
        err.code === "venta_ya_anulada" ? 409 :
        400; // sin_caja | caja_cerrada
      return NextResponse.json(errorResponse(err.message), { status });
    }
    const msg = err instanceof Error ? err.message : "No se pudo anular la venta.";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
