import { NextRequest, NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { leerArchivoYAuth } from "@/lib/imports/import-helpers";
import { parseCategoriasRows, buildCatMap, buildCatPreview } from "@/lib/imports/catalogos-importer";

export async function POST(request: NextRequest) {
  const res = await leerArchivoYAuth(request);
  if (!res.ok) return NextResponse.json(errorResponse(res.error), { status: res.status });
  try {
    const parsed = parseCategoriasRows(res.ctx.rows);
    const byName = await buildCatMap(res.ctx.schema, res.ctx.empresaId);
    return NextResponse.json(successResponse(buildCatPreview(parsed, byName)));
  } catch (e) {
    console.error("[categorias/import/preview]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo generar la vista previa."), { status: 500 });
  }
}
