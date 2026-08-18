import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { confirmarImpresionCuponesEntrada } from "@/lib/sorteos/sorteo-entrada-confirmar-impresion";
import { invalidateSorteosListCachesForEmpresa } from "@/lib/sorteos/server-queries";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s.trim());
}

/**
 * POST /api/sorteos/entradas/:entrada_id/confirmar-impresion
 * Body: { sorteo_id: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ entrada_id: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }

    const { entrada_id: entradaId } = await params;
    if (!isUuid(entradaId)) {
      return NextResponse.json(errorResponse("entrada_id inválido"), { status: 400 });
    }

    let body: { sorteo_id?: string };
    try {
      body = (await request.json()) as { sorteo_id?: string };
    } catch {
      return NextResponse.json(errorResponse("JSON inválido"), { status: 400 });
    }

    const sorteoId = typeof body.sorteo_id === "string" ? body.sorteo_id.trim() : "";
    if (!isUuid(sorteoId)) {
      return NextResponse.json(errorResponse("sorteo_id requerido e inválido"), { status: 400 });
    }

    const empresaId = ctx.auth.empresa_id;
    const catalogId = ctx.auth.usuarioCatalogId;
    const authUserId = ctx.auth.user?.id;
    const usuarioUuid =
      typeof catalogId === "string" && isUuid(catalogId)
        ? catalogId
        : typeof authUserId === "string" && isUuid(authUserId)
          ? authUserId
          : null;

    const result = await confirmarImpresionCuponesEntrada({
      empresaId,
      usuarioUuid,
      entradaId,
      sorteoId,
    });

    if (!result.ok) {
      return NextResponse.json(errorResponse(result.message), { status: result.status });
    }

    const dataSchema = await fetchDataSchemaForEmpresaId(empresaId);
    invalidateSorteosListCachesForEmpresa(empresaId, dataSchema);

    return NextResponse.json(
      successResponse({
        cupones_impresion_count: result.cupones_impresion_count,
        cupones_impresos_at: result.cupones_impresos_at,
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
