import { NextRequest, NextResponse } from "next/server";
import { getFacturasSupabaseFromAuth } from "@/lib/facturacion/facturas-service-client";
import { errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { handleSifenEnviarPost } from "@/lib/sifen/handle-sifen-enviar-post";

/**
 * POST /api/facturas/[id]/sifen/enviar-test
 * Igual que `/sifen/enviar` pero solo si la configuración está en ambiente `test` (compatibilidad).
 *
 * Usa el mismo helper que `/sifen/enviar` para soportar tenants `erp_*` no expuestos en PostgREST.
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getFacturasSupabaseFromAuth(request);
  if (!auth) {
    return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
  }
  try {
    return await handleSifenEnviarPost(request, ctx.params, auth.auth, auth.supabase, {
      soloAmbienteTest: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
