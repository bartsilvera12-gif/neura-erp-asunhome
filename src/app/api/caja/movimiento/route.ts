import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { registrarMovimiento, getCajaAbierta } from "@/lib/caja/server";

/**
 * POST /api/caja/movimiento
 *   Registra un movimiento manual en la caja abierta.
 *   Body: { tipo, concepto, monto, medio_pago?, observacion?, caja_id? }
 *   Si caja_id no viene, se usa la caja abierta actual.
 */
const TIPOS_VALIDOS = ["ingreso", "egreso", "retiro", "ajuste"] as const;
const MEDIOS_VALIDOS = ["efectivo", "tarjeta", "transferencia", "otro"] as const;

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(errorResponse("JSON inválido."), { status: 400 });
    }
    const o = (body ?? {}) as Record<string, unknown>;

    const tipo = String(o.tipo ?? "");
    if (!(TIPOS_VALIDOS as readonly string[]).includes(tipo)) {
      return NextResponse.json(errorResponse("Tipo inválido."), { status: 400 });
    }
    const medioPago = String(o.medio_pago ?? "efectivo");
    if (!(MEDIOS_VALIDOS as readonly string[]).includes(medioPago)) {
      return NextResponse.json(errorResponse("Medio de pago inválido."), { status: 400 });
    }
    const concepto = String(o.concepto ?? "").trim();
    if (!concepto || concepto.length > 200) {
      return NextResponse.json(errorResponse("Concepto requerido (máx. 200 chars)."), { status: 400 });
    }
    const monto = Number(o.monto);
    if (!Number.isFinite(monto)) {
      return NextResponse.json(errorResponse("Monto inválido."), { status: 400 });
    }
    if (tipo !== "ajuste" && monto <= 0) {
      return NextResponse.json(
        errorResponse("El monto debe ser > 0 (solo ajustes pueden ser negativos)."),
        { status: 400 }
      );
    }
    const observacion =
      o.observacion == null || o.observacion === "" ? null : String(o.observacion).slice(0, 1000);

    let cajaId = o.caja_id == null || o.caja_id === "" ? null : String(o.caja_id);
    if (!cajaId) {
      const abierta = await getCajaAbierta(ctx.supabase, ctx.auth.empresa_id);
      if (!abierta) {
        return NextResponse.json(
          errorResponse("No hay ninguna caja abierta."),
          { status: 409 }
        );
      }
      cajaId = abierta.id;
    }

    const movimiento = await registrarMovimiento(ctx.supabase, {
      empresaId: ctx.auth.empresa_id,
      cajaId,
      tipo: tipo as (typeof TIPOS_VALIDOS)[number],
      concepto,
      monto,
      medioPago: medioPago as (typeof MEDIOS_VALIDOS)[number],
      observacion,
      usuarioId: ctx.auth.usuarioCatalogId ?? null,
      usuarioEmail: ctx.auth.user?.email ?? null,
    });
    return NextResponse.json(successResponse({ movimiento }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo registrar el movimiento.";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
