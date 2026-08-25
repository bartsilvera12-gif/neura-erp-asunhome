/** GET /api/cuentas-por-pagar — cuotas para el panel de pagos a proveedores. */
import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { listCuotas } from "@/lib/cuentas-por-pagar/server/cxp-pg";

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const cuotas = await listCuotas(schema, ctx.auth.empresa_id);
    return NextResponse.json(successResponse({ cuotas }));
  } catch (err) {
    console.error("[/api/cuentas-por-pagar GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las cuentas por pagar."), { status: 500 });
  }
}
