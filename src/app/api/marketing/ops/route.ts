import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { loadMarketingOpsDashboard } from "@/lib/marketing/ops-queries";

/**
 * GET /api/marketing/ops?mes=YYYY-MM
 * Panel Marketing Ops: clientes (suscripción marketing y/o tipo servicio), tareas del mes, métricas.
 * Usa el schema de datos de la empresa (service role + data_schema); no requiere rol admin.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx?.auth?.user?.email) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }

    const empresaId = ctx.auth.empresa_id;
    if (!empresaId) {
      return NextResponse.json(errorResponse("Usuario sin empresa asignada"), { status: 403 });
    }

    const mes = request.nextUrl.searchParams.get("mes")?.trim() || new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(mes)) {
      return NextResponse.json(errorResponse("Formato mes inválido (usar YYYY-MM)"), { status: 400 });
    }

    const data = await loadMarketingOpsDashboard({
      empresa_id: empresaId,
      mes,
      supabase: ctx.supabase,
    });

    return NextResponse.json(successResponse(data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    console.error("[api/marketing/ops] GET:", err);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
