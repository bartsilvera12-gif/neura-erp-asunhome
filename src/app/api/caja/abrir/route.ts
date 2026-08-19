import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { abrirCaja } from "@/lib/caja/server";
import { normalizarArqueo } from "@/lib/caja/denominaciones";

/** POST /api/caja/abrir — abre la caja con monto inicial. */
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

    // Arqueo por denominaciones (opcional). Si viene, el saldo inicial se
    // calcula desde el detalle; si no, se usa monto_apertura manual.
    let arqueoApertura = null;
    if (o.arqueo_apertura != null) {
      arqueoApertura = normalizarArqueo(o.arqueo_apertura);
      if (arqueoApertura == null) {
        return NextResponse.json(
          errorResponse("Arqueo inválido: revisá las denominaciones y cantidades (no negativas, enteras)."),
          { status: 400 }
        );
      }
    }

    const montoApertura = Number(o.monto_apertura);
    // El monto manual solo se valida cuando NO se usa arqueo.
    if (arqueoApertura == null && (!Number.isFinite(montoApertura) || montoApertura < 0)) {
      return NextResponse.json(errorResponse("Monto de apertura inválido."), { status: 400 });
    }
    const observacion =
      o.observacion == null || o.observacion === "" ? null : String(o.observacion).slice(0, 2000);
    const numeroRaw = Number(o.numero_caja);
    const numeroCaja = Number.isFinite(numeroRaw) && numeroRaw >= 1 ? Math.floor(numeroRaw) : null;

    const caja = await abrirCaja(ctx.supabase, {
      empresaId: ctx.auth.empresa_id,
      montoApertura: Number.isFinite(montoApertura) ? montoApertura : 0,
      observacion,
      usuarioId: ctx.auth.usuarioCatalogId ?? null,
      numeroCaja,
      arqueoApertura,
    });
    return NextResponse.json(successResponse({ caja }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo abrir la caja.";
    const status = /ya está activa/i.test(msg) ? 409 : 500;
    return NextResponse.json(errorResponse(msg), { status });
  }
}
