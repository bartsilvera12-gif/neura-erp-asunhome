import { NextRequest, NextResponse } from "next/server";
import { getUserAndEmpresa } from "@/lib/middleware/auth";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { devolucionesEnabled } from "@/lib/devoluciones/feature-flag";
import { anularDevolucion } from "@/lib/devoluciones/server/devoluciones-pg";
import { DevolucionBloqueadaError } from "@/lib/devoluciones/types";

/**
 * POST /api/devoluciones/[id]/anular
 * Crea los movimientos inversos de inventario y caja. NO borra la devolución:
 * queda con estado 'anulada' para auditoría. Transaccional.
 */
export async function POST(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  if (!devolucionesEnabled()) {
    return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
  }
  try {
    const { id } = await ctxParams.params;
    const auth = await getUserAndEmpresa(request);
    if (!auth?.empresa_id) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const body = (await request.json().catch(() => ({}))) as { motivo?: string };
    const schema = await fetchDataSchemaForEmpresaId(auth.empresa_id);
    const devolucion = await anularDevolucion(
      schema,
      auth.empresa_id,
      { id: auth.usuarioCatalogId ?? null, nombre: auth.nombre ?? auth.user?.email ?? null },
      id,
      typeof body.motivo === "string" ? body.motivo.slice(0, 500) : null
    );
    return NextResponse.json(successResponse({ devolucion }));
  } catch (err) {
    if (err instanceof DevolucionBloqueadaError) {
      return NextResponse.json(
        { success: false, error: err.message, motivo: err.motivo },
        { status: err.motivo === "devolucion_no_encontrada" ? 404 : 409 }
      );
    }
    const msg = err instanceof Error ? err.message : "No se pudo anular la devolución.";
    console.error("[/api/devoluciones/[id]/anular POST]", msg);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
