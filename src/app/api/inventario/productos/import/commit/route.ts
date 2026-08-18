import { NextRequest, NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { leerArchivoYAuth } from "@/lib/imports/import-helpers";
import { parseProductosRows, buildResolverMaps, buildPreview, commitProductos } from "@/lib/imports/productos-importer";
import { registrarImportAudit } from "@/lib/excel/imports-audit-pg";

export async function POST(request: NextRequest) {
  const res = await leerArchivoYAuth(request);
  if (!res.ok) return NextResponse.json(errorResponse(res.error), { status: res.status });
  try {
    const parsed = parseProductosRows(res.ctx.rows);
    const maps = await buildResolverMaps(res.ctx.schema, res.ctx.empresaId);
    buildPreview(parsed, maps); // marca .match_id y .errors/.warnings
    const out = await commitProductos(res.ctx.schema, res.ctx.empresaId, parsed, maps, res.ctx.crearFaltantes, {
      filename: res.ctx.filename,
      createdBy: res.ctx.usuarioCatalogId,
      usuarioNombre: res.ctx.usuarioNombre,
    });
    const auditWarnings = [
      ...out.warningMessages,
      `Movimientos generados: ${out.movimientos_generados} (entrada=${out.unidades_entrada}, salida=${out.unidades_salida})`,
    ];
    const auditId = await registrarImportAudit(res.ctx.schema, res.ctx.empresaId, {
      entidad: "productos", filename: res.ctx.filename, total_rows: parsed.length,
      inserted_count: out.inserted, updated_count: out.updated, skipped_count: out.skipped,
      error_count: out.errors, warning_count: out.warnings,
      errors_json: out.errorMessages, warnings_json: auditWarnings,
      created_by: res.ctx.usuarioCatalogId, usuario_nombre: res.ctx.usuarioNombre,
    });
    return NextResponse.json(successResponse({
      summary: {
        total: parsed.length, inserted: out.inserted, updated: out.updated, skipped: out.skipped,
        errors: out.errors, warnings: out.warnings,
        movimientos_generados: out.movimientos_generados,
        unidades_entrada: out.unidades_entrada,
        unidades_salida: out.unidades_salida,
      },
      warnings: out.warningMessages,
      errors: out.errorMessages,
      audit_id: auditId,
    }));
  } catch (e) {
    console.error("[productos/import/commit]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo importar."), { status: 500 });
  }
}
