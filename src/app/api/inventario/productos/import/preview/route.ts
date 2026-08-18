import { NextRequest, NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { leerArchivoYAuth } from "@/lib/imports/import-helpers";
import { parseProductosRows, buildResolverMaps, buildPreview } from "@/lib/imports/productos-importer";

export async function POST(request: NextRequest) {
  const res = await leerArchivoYAuth(request);
  if (!res.ok) return NextResponse.json(errorResponse(res.error), { status: res.status });
  try {
    const parsed = parseProductosRows(res.ctx.rows);
    const maps = await buildResolverMaps(res.ctx.schema, res.ctx.empresaId);
    const preview = buildPreview(parsed, maps);
    return NextResponse.json(successResponse(preview));
  } catch (e) {
    console.error("[productos/import/preview]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo generar la vista previa."), { status: 500 });
  }
}
