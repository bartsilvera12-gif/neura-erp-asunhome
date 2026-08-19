import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getComprasPanel } from "@/lib/reportes/server/compras-panel-pg";
import { asuncionRangeBoundsUtc } from "@/lib/fechas/asuncion-bounds";

/**
 * GET /api/reportes/compras-panel?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 *
 * Panel de compras con dos vistas: compras confirmadas del período y
 * ordenados no comprados (líneas de OC pendientes de recibir). El rango
 * desde/hasta aplica a la fecha de la compra (vista 1) y a la fecha de la
 * orden (vista 2).
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);

    const sp = new URL(request.url).searchParams;
    const desdeRaw = sp.get("desde");
    const hastaRaw = sp.get("hasta");
    const { start, end } = asuncionRangeBoundsUtc(desdeRaw, hastaRaw);
    // Fechas de display (si no vinieron, quedan como las mandó el cliente o vacío).
    const desde = desdeRaw ?? "";
    const hasta = hastaRaw ?? "";

    const data = await getComprasPanel(schema, ctx.auth.empresa_id, { start, end, desde, hasta });
    return NextResponse.json(successResponse(data));
  } catch (err) {
    console.error("[/api/reportes/compras-panel]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el panel de compras."), { status: 500 });
  }
}
