/** POST /api/reservas/[id]/pago — registra un anticipo/pago (entra a caja). */
import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { registrarPagoReserva } from "@/lib/reservas/server/reservas-pg";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const { id } = await params;
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const r = await registrarPagoReserva(
      schema, ctx.auth.empresa_id,
      {
        reservaId: id,
        monto: Number(b.monto),
        metodoPago: b.metodo_pago != null ? String(b.metodo_pago) : null,
        entidadBancariaId: b.entidad_bancaria_id != null && String(b.entidad_bancaria_id).trim() ? String(b.entidad_bancaria_id) : null,
        referencia: b.referencia != null ? String(b.referencia).slice(0, 200) : null,
        observaciones: b.observaciones != null ? String(b.observaciones).slice(0, 500) : null,
      },
      { id: ctx.auth.usuarioCatalogId ?? null, email: ctx.auth.user?.email ?? null }
    );
    return NextResponse.json(successResponse(r));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo registrar el pago.";
    console.error("[/api/reservas/[id]/pago POST]", msg);
    const status = /no encontrada|no está activa|supera el saldo|mayor a 0/i.test(msg) ? 400 : 500;
    return NextResponse.json(errorResponse(msg), { status });
  }
}
