import { NextRequest, NextResponse } from "next/server";
import { getUserAndEmpresa } from "@/lib/middleware/auth";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { devolucionesEnabled } from "@/lib/devoluciones/feature-flag";
import { getDevolucion } from "@/lib/devoluciones/server/devoluciones-pg";

/** GET /api/devoluciones/[id] — detalle con items y cambios. */
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
    const devolucion = await getDevolucion(schema, auth.empresa_id, id);
    if (!devolucion) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    return NextResponse.json(successResponse({ devolucion }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo cargar la devolución.";
    console.error("[/api/devoluciones/[id] GET]", msg);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
