import { NextRequest, NextResponse } from "next/server";
import { getFacturasSupabaseFromAuth } from "@/lib/facturacion/facturas-service-client";
import { errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { handleSifenConsultaLotePost } from "@/lib/sifen/handle-sifen-consulta-lote-post";

/**
 * POST /api/facturas/[id]/sifen/consulta-lote-test
 * Igual que `/sifen/consulta-lote` pero solo si ambiente `test` (compatibilidad).
 *
 * Resuelve el cliente Supabase con el helper de facturación (PG shim para
 * tenants `erp_*` no expuestos, service role estándar para legacy).
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getFacturasSupabaseFromAuth(request);
  if (!auth) {
    return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
  }
  try {
    return await handleSifenConsultaLotePost(request, ctx.params, auth.auth, auth.supabase, {
      soloAmbienteTest: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
