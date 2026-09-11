/**
 * POST /api/reservas/[id]/facturar — factura una guarda (o ítems seleccionados)
 * como venta (ticket) SIN re-descontar stock ni generar ingreso de caja nuevo.
 * Body opcional: { item_ids?: string[] } — si viene, factura solo esos productos
 * (facturación parcial); si no, factura todos los pendientes.
 * Idempotente: ítems ya facturados se saltan / devuelve la venta existente.
 */
import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { facturarReservaPg, FacturarReservaError } from "@/lib/reservas/server/reservas-pg";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const { id } = await params;

    const body = (await request.json().catch(() => ({}))) as { item_ids?: unknown };
    const itemIds = Array.isArray(body.item_ids)
      ? body.item_ids.map((x) => String(x)).filter((x) => x.trim() !== "")
      : null;

    const result = await facturarReservaPg(
      schema,
      ctx.auth.empresa_id,
      id,
      { id: ctx.auth.usuarioCatalogId ?? null, nombre: ctx.auth.nombre ?? ctx.auth.user?.email ?? null },
      itemIds && itemIds.length > 0 ? itemIds : null
    );

    return NextResponse.json(
      successResponse({
        ok: true,
        venta_id: result.ventaId,
        numero_control: result.numeroControl,
        reserva_numero: result.reservaNumero,
        deduped: result.deduped,
        reserva_completa: result.reservaCompleta,
      })
    );
  } catch (err) {
    if (err instanceof FacturarReservaError) {
      const status =
        err.code === "reserva_no_encontrada" ? 404 :
        err.code === "pago_insuficiente" ? 409 :
        err.code === "nada_para_facturar" ? 409 :
        400; // reserva_cancelada
      return NextResponse.json(errorResponse(err.message), { status });
    }
    const msg = err instanceof Error ? err.message : "No se pudo facturar la guarda.";
    console.error("[/api/reservas/[id]/facturar POST]", msg);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
