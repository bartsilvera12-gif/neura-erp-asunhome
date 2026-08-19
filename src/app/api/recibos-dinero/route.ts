import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { crearOReusarRecibo, ReciboError, type OrigenRecibo } from "@/lib/recibos/server/recibos-pg";

/**
 * POST /api/recibos-dinero — crea (o reutiliza si ya existe) un recibo de dinero.
 * Body: { origen: 'venta_contado'|'cobro_cxc', venta_id?, cobro_cliente_id?, observaciones? }
 * NO toca stock, ventas, cobros ni deuda. Documento interno NO fiscal.
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

    const origen = body.origen as OrigenRecibo;
    if (origen !== "venta_contado" && origen !== "cobro_cxc") {
      return NextResponse.json(errorResponse("Origen inválido (venta_contado | cobro_cxc)."), { status: 400 });
    }

    const { recibo, existed } = await crearOReusarRecibo(
      ctx.supabase,
      ctx.auth.empresa_id,
      {
        origen,
        venta_id: body.venta_id ? String(body.venta_id) : null,
        cobro_cliente_id: body.cobro_cliente_id ? String(body.cobro_cliente_id) : null,
        observaciones: body.observaciones ? String(body.observaciones).slice(0, 2000) : null,
      },
      { id: ctx.auth.user?.id ?? null, nombre: ctx.auth.nombre ?? ctx.auth.user?.email ?? null }
    );

    return NextResponse.json(successResponse({ recibo, existed }));
  } catch (err) {
    if (err instanceof ReciboError) {
      return NextResponse.json(errorResponse(err.message), { status: err.status });
    }
    console.error("[/api/recibos-dinero POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo generar el recibo."), { status: 500 });
  }
}
