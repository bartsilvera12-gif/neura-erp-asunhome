/** GET /api/compras/provisorias — lista compras en estado provisoria (agrupadas). */
import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { listProvisorias } from "@/lib/cuentas-por-pagar/server/cxp-pg";

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const provisorias = await listProvisorias(schema, ctx.auth.empresa_id);
    return NextResponse.json(successResponse({ provisorias }));
  } catch (err) {
    console.error("[/api/compras/provisorias GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las provisorias."), { status: 500 });
  }
}
