import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getExtractoCliente } from "@/lib/reportes/server/creditos-pg";

/** GET /api/reportes/creditos/[clienteId] — extracto de crédito de un cliente. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clienteId: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { clienteId } = await params;
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const data = await getExtractoCliente(schema, ctx.auth.empresa_id, clienteId);
    if (!data) return NextResponse.json(errorResponse("Cliente no encontrado."), { status: 404 });
    return NextResponse.json(successResponse(data));
  } catch (err) {
    console.error("[/api/reportes/creditos/[clienteId]]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el extracto del cliente."), { status: 500 });
  }
}
