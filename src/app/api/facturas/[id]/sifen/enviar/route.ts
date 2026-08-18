import { NextRequest, NextResponse } from "next/server";
import { getFacturasSupabaseFromAuth } from "@/lib/facturacion/facturas-service-client";
import { errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { handleSifenEnviarPost } from "@/lib/sifen/handle-sifen-enviar-post";

/**
 * POST /api/facturas/[id]/sifen/enviar
 * Envía el XML firmado a SIFEN según `empresa_sifen_config.ambiente` (test | producción).
 *
 * Usa el helper de facturación (PG shim para tenants `erp_*` no expuestos,
 * service role estándar para `zentra_erp` y legacy) para resolver el cliente
 * Supabase antes de invocar el handler compartido. Antes, el handler creaba
 * internamente un cliente con PostgREST `db.schema = erp_*` y rompía con PGRST106.
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getFacturasSupabaseFromAuth(request);
  if (!auth) {
    return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
  }
  try {
    return await handleSifenEnviarPost(request, ctx.params, auth.auth, auth.supabase, {
      soloAmbienteTest: false,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
