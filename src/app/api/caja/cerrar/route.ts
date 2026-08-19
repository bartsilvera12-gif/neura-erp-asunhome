import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { cerrarCaja, getCajaAbierta } from "@/lib/caja/server";
import { normalizarArqueo } from "@/lib/caja/denominaciones";

/**
 * POST /api/caja/cerrar — cierra la caja con efectivo contado y calcula
 * diferencia. caja_id es opcional: si no viene, usa la caja abierta actual.
 */
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

    // Arqueo por denominaciones (opcional). Si viene, el saldo contado se
    // calcula desde el detalle; si no, se usa monto_cierre_contado manual.
    let arqueoCierre = null;
    if (o.arqueo_cierre != null) {
      arqueoCierre = normalizarArqueo(o.arqueo_cierre);
      if (arqueoCierre == null) {
        return NextResponse.json(
          errorResponse("Arqueo inválido: revisá las denominaciones y cantidades (no negativas, enteras)."),
          { status: 400 }
        );
      }
    }

    const montoCierre = Number(o.monto_cierre_contado);
    if (arqueoCierre == null && (!Number.isFinite(montoCierre) || montoCierre < 0)) {
      return NextResponse.json(errorResponse("Monto contado inválido."), { status: 400 });
    }
    const observacion =
      o.observacion == null || o.observacion === "" ? null : String(o.observacion).slice(0, 2000);

    let cajaId = o.caja_id == null || o.caja_id === "" ? null : String(o.caja_id);
    if (!cajaId) {
      const abierta = await getCajaAbierta(ctx.supabase, ctx.auth.empresa_id);
      if (!abierta) {
        return NextResponse.json(
          errorResponse("No hay ninguna caja abierta para cerrar."),
          { status: 409 }
        );
      }
      cajaId = abierta.id;
    }

    const resumen = await cerrarCaja(ctx.supabase, {
      empresaId: ctx.auth.empresa_id,
      cajaId,
      montoCierreContado: Number.isFinite(montoCierre) ? montoCierre : 0,
      observacion,
      usuarioId: ctx.auth.usuarioCatalogId ?? null,
      arqueoCierre,
    });
    return NextResponse.json(successResponse({ resumen }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo cerrar la caja.";
    const status = /no encontrada|ya está cerrada/i.test(msg) ? 409 : 500;
    return NextResponse.json(errorResponse(msg), { status });
  }
}
