import { NextRequest, NextResponse } from "next/server";
import { getUserAndEmpresa } from "@/lib/middleware/auth";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { devolucionesEnabled } from "@/lib/devoluciones/feature-flag";
import { getVentaDevolvible } from "@/lib/devoluciones/server/devoluciones-pg";

/**
 * GET /api/ventas/[id]/devolucion
 * Venta + lineas devolvibles (con cantidad ya devuelta y disponible) para el wizard.
 * Con el feature flag apagado responde 404 (el modulo no existe para el cliente).
 */
export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  if (!devolucionesEnabled()) {
    return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
  }
  try {
    const { id } = await ctxParams.params;
    const auth = await getUserAndEmpresa(request);
    if (!auth?.empresa_id) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const schema = await fetchDataSchemaForEmpresaId(auth.empresa_id);
    const venta = await getVentaDevolvible(schema, auth.empresa_id, id);
    if (!venta) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    return NextResponse.json(successResponse({ venta }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo cargar la venta.";
    console.error("[/api/ventas/[id]/devolucion GET]", msg);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
