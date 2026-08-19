import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { anularOrdenCompraConReversion } from "@/lib/ordenes-compra/server/anular-oc-pg";

/**
 * POST /api/ordenes-compra/[numero]/anular
 *
 * Anula una OC y revierte todas sus recepciones (compras). Sirve tanto
 * para OC pendientes (equivalente al `cancelar` clasico) como para OC
 * parcial o totalmente recibidas: en esos casos ademas devuelve stock,
 * crea contra-movimientos SALIDA en Inventario > Movimientos y marca
 * las compras vinculadas como anuladas.
 *
 * Body: { motivo?: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ numero: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const { numero } = await params;
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const motivo = body.motivo != null ? String(body.motivo) : null;

    const result = await anularOrdenCompraConReversion(
      schema,
      ctx.auth.empresa_id,
      decodeURIComponent(numero),
      motivo,
      ctx.auth.usuarioCatalogId ?? null
    );

    if (!result.ok) {
      return NextResponse.json(errorResponse(result.error), { status: result.status });
    }
    return NextResponse.json(successResponse(result));
  } catch (err) {
    console.error(
      "[/api/ordenes-compra/[numero]/anular]",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      errorResponse("No se pudo anular la orden de compra."),
      { status: 500 }
    );
  }
}
