import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getEstadoCajas } from "@/lib/caja/server";

/**
 * GET /api/caja/estado
 *
 * Devuelve TODAS las cajas activas de la empresa (abiertas o en cierre/conteo)
 * con su resumen/arqueo en vivo. Soporta múltiples cajas (Caja 1, Caja 2, …).
 * Respuesta: { cajas: CajaResumen[] } (vacío si no hay ninguna activa).
 *
 * `caja`/`resumen` (singular, la primera abierta) se mantienen por compatibilidad.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const cajas = await getEstadoCajas(ctx.supabase, ctx.auth.empresa_id);
    const primera = cajas.find((c) => c.caja.estado === "abierta") ?? cajas[0] ?? null;
    return NextResponse.json(
      successResponse({
        cajas,
        caja: primera ? primera.caja : null,
        resumen: primera ?? null,
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo cargar el estado de caja.";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
