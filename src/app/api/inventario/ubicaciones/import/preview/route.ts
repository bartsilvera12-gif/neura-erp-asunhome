import { NextRequest, NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { leerArchivoYAuth } from "@/lib/imports/import-helpers";
import { parseUbicacionesRows, buildUbiMaps, buildUbiPreview } from "@/lib/imports/catalogos-importer";

export async function POST(request: NextRequest) {
  const res = await leerArchivoYAuth(request);
  if (!res.ok) return NextResponse.json(errorResponse(res.error), { status: res.status });
  try {
    const parsed = parseUbicacionesRows(res.ctx.rows);
    const maps = await buildUbiMaps(res.ctx.schema, res.ctx.empresaId);
    return NextResponse.json(successResponse(buildUbiPreview(parsed, maps)));
  } catch (e) {
    console.error("[ubicaciones/import/preview]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo generar la vista previa."), { status: 500 });
  }
}
