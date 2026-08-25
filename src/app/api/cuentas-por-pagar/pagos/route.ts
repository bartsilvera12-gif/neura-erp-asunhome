/**
 * POST /api/cuentas-por-pagar/pagos — registra un pago (parcial o total) de una cuota.
 * Body: { cuota_id, monto, fecha_pago?, metodo_pago?, referencia?, observaciones? }
 */
import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { registrarPagoProveedor } from "@/lib/cuentas-por-pagar/server/cxp-pg";

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);

    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const cuotaId = b.cuota_id != null ? String(b.cuota_id) : "";
    const monto = Number(b.monto);
    if (!cuotaId) return NextResponse.json(errorResponse("Falta cuota_id."), { status: 400 });
    if (!Number.isFinite(monto) || monto <= 0)
      return NextResponse.json(errorResponse("El monto debe ser mayor a 0."), { status: 400 });

    await registrarPagoProveedor(schema, ctx.auth.empresa_id, {
      cuotaId,
      monto,
      fechaPago: b.fecha_pago != null && String(b.fecha_pago).trim() ? String(b.fecha_pago).slice(0, 10) : null,
      metodoPago: b.metodo_pago != null ? String(b.metodo_pago).slice(0, 40) : null,
      referencia: b.referencia != null ? String(b.referencia).slice(0, 200) : null,
      observaciones: b.observaciones != null ? String(b.observaciones).slice(0, 500) : null,
    });
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo registrar el pago.";
    console.error("[/api/cuentas-por-pagar/pagos POST]", msg);
    const status = /no encontrada|supera el saldo|mayor a 0/i.test(msg) ? 400 : 500;
    return NextResponse.json(errorResponse(msg), { status });
  }
}
