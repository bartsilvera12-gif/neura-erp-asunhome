import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { ponerCajaEnCierre } from "@/lib/caja/server";

/**
 * POST /api/caja/en-cierre — pasa una caja abierta a estado 'en_cierre' (conteo).
 * Deja de recibir ventas y movimientos, pero todavía no está cerrada.
 * Body: { caja_id }.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const cajaId = body.caja_id != null ? String(body.caja_id) : "";
    if (!cajaId) return NextResponse.json(errorResponse("Falta la caja."), { status: 400 });

    const caja = await ponerCajaEnCierre(ctx.supabase, ctx.auth.empresa_id, cajaId);
    return NextResponse.json(successResponse({ caja }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo pasar la caja a cierre.";
    const status = /no está abierta/i.test(msg) ? 409 : 500;
    return NextResponse.json(errorResponse(msg), { status });
  }
}
