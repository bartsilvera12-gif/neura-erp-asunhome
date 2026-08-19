import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

/**
 * PATCH /api/compras/[numero_control]
 *
 * Edita SOLO campos de metadata que no impactan stock, costo promedio, ni CxP:
 *   - numero_factura, fecha_factura, nro_timbrado, observacion.
 * Aplica el update a TODAS las filas de la compra (comparten numero_control).
 * Bloqueado si la compra esta anulada.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ numero_control: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const { numero_control } = await params;
    const numeroControl = decodeURIComponent(numero_control);
    const schemaRaw = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const schema = assertAllowedChatDataSchema(schemaRaw);
    const empresaId = ctx.auth.empresa_id;

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const s = (k: string) => (typeof body[k] === "string" ? (body[k] as string).trim() : "");

    // Solo aceptamos los 4 campos seguros.
    const patch = {
      numero_factura: s("numero_factura") || null,
      fecha_factura: s("fecha_factura") || null,
      nro_timbrado: s("nro_timbrado") || null,
      observacion: s("observacion") || null,
    };

    // Validacion basica de fecha_factura (YYYY-MM-DD) si viene.
    if (patch.fecha_factura && !/^\d{4}-\d{2}-\d{2}$/.test(patch.fecha_factura)) {
      return NextResponse.json(errorResponse("Fecha de factura inválida (YYYY-MM-DD)."), { status: 400 });
    }

    const t = quoteSchemaTable(schema, "compras");
    const client = await pool().connect();
    try {
      await client.query("BEGIN");

      const { rowCount: existentes } = await client.query(
        `SELECT 1 FROM ${t}
          WHERE empresa_id = $1::uuid AND numero_control = $2 AND anulada_at IS NULL LIMIT 1`,
        [empresaId, numeroControl]
      );
      if (!existentes) {
        await client.query("ROLLBACK");
        return NextResponse.json(errorResponse("Compra no encontrada o ya anulada."), { status: 404 });
      }

      const { rowCount } = await client.query(
        `UPDATE ${t}
            SET numero_factura = $3,
                fecha_factura = $4::date,
                nro_timbrado = COALESCE($5, nro_timbrado),
                observacion = $6,
                updated_at = now()
          WHERE empresa_id = $1::uuid AND numero_control = $2 AND anulada_at IS NULL`,
        [empresaId, numeroControl, patch.numero_factura, patch.fecha_factura, patch.nro_timbrado, patch.observacion]
      );

      await client.query("COMMIT");
      return NextResponse.json(successResponse({ ok: true, filas_actualizadas: rowCount ?? 0 }));
    } catch (err) {
      await client.query("ROLLBACK").catch(() => null);
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[/api/compras/[numero_control] PATCH]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo actualizar la compra."), { status: 500 });
  }
}
