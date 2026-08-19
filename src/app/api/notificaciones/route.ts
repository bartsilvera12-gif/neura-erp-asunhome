import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { listNotificaciones, evaluarStockClaseA } from "@/lib/notificaciones/server";
import { evaluarComisionesMensuales } from "@/lib/notificaciones/comisiones";

/**
 * GET /api/notificaciones
 * Devuelve las notificaciones de la empresa + contador de no leídas.
 * De paso evalúa (throttled, best-effort) el stock bajo de productos clase A.
 * Resiliente: si la tabla aún no existe (migración pendiente) devuelve vacío.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);

    // Evaluación best-effort: nunca debe romper la campanita.
    try {
      await evaluarStockClaseA(schema, ctx.auth.empresa_id);
    } catch (e) {
      console.error("[/api/notificaciones] evaluar stock:", e instanceof Error ? e.message : e);
    }
    try {
      await evaluarComisionesMensuales(schema, ctx.auth.empresa_id);
    } catch (e) {
      console.error("[/api/notificaciones] evaluar comisiones mensuales:", e instanceof Error ? e.message : e);
    }

    try {
      const data = await listNotificaciones(schema, ctx.auth.empresa_id);
      return NextResponse.json(successResponse(data));
    } catch (e) {
      // Tabla ausente u otro error de lectura: no romper la UI.
      console.error("[/api/notificaciones] list:", e instanceof Error ? e.message : e);
      return NextResponse.json(successResponse({ notificaciones: [], no_leidas: 0 }));
    }
  } catch (err) {
    console.error("[/api/notificaciones]", err instanceof Error ? err.message : err);
    return NextResponse.json(successResponse({ notificaciones: [], no_leidas: 0 }));
  }
}
