import { NextRequest, NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { leerArchivoYAuth } from "@/lib/imports/import-helpers";
import { parseCategoriasRows, buildCatMap, buildCatPreview, commitCategorias } from "@/lib/imports/catalogos-importer";
import { registrarImportAudit } from "@/lib/excel/imports-audit-pg";

export async function POST(request: NextRequest) {
  const res = await leerArchivoYAuth(request);
  if (!res.ok) return NextResponse.json(errorResponse(res.error), { status: res.status });
  try {
    const parsed = parseCategoriasRows(res.ctx.rows);
    const byName = await buildCatMap(res.ctx.schema, res.ctx.empresaId);
    buildCatPreview(parsed, byName);
    const out = await commitCategorias(res.ctx.schema, res.ctx.empresaId, parsed, byName, res.ctx.crearFaltantes);
    const auditId = await registrarImportAudit(res.ctx.schema, res.ctx.empresaId, {
      entidad: "categorias_productos", filename: res.ctx.filename, total_rows: parsed.length,
      inserted_count: out.inserted, updated_count: out.updated, skipped_count: out.skipped,
      error_count: out.errors, warning_count: out.warnings,
      errors_json: out.errorMessages, warnings_json: out.warningMessages,
      created_by: res.ctx.usuarioCatalogId, usuario_nombre: res.ctx.usuarioNombre,
    });
    return NextResponse.json(successResponse({
      summary: { total: parsed.length, inserted: out.inserted, updated: out.updated, skipped: out.skipped, errors: out.errors, warnings: out.warnings },
      warnings: out.warningMessages, errors: out.errorMessages, audit_id: auditId,
    }));
  } catch (e) {
    console.error("[categorias/import/commit]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo importar."), { status: 500 });
  }
}
