import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

export interface AuditInput {
  entidad: string;
  filename?: string | null;
  total_rows: number;
  inserted_count: number;
  updated_count: number;
  skipped_count: number;
  error_count: number;
  warning_count: number;
  errors_json?: unknown;
  warnings_json?: unknown;
  created_by?: string | null;
  usuario_nombre?: string | null;
}

export async function registrarImportAudit(
  schemaRaw: string,
  empresaId: string,
  d: AuditInput
): Promise<string | null> {
  try {
    const schema = assertAllowedChatDataSchema(schemaRaw);
    const pool = getChatPostgresPool();
    if (!pool) return null;
    const t = quoteSchemaTable(schema, "imports_audit");
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO ${t} (
         empresa_id, entidad, filename, total_rows, inserted_count, updated_count,
         skipped_count, error_count, warning_count, errors_json, warnings_json,
         created_by, usuario_nombre
       ) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13)
       RETURNING id`,
      [
        empresaId,
        d.entidad,
        d.filename ?? null,
        d.total_rows,
        d.inserted_count,
        d.updated_count,
        d.skipped_count,
        d.error_count,
        d.warning_count,
        d.errors_json ? JSON.stringify(d.errors_json) : null,
        d.warnings_json ? JSON.stringify(d.warnings_json) : null,
        d.created_by ?? null,
        d.usuario_nombre ?? null,
      ]
    );
    return rows[0]?.id ?? null;
  } catch (e) {
    console.error("[imports-audit] registrar:", e instanceof Error ? e.message : e);
    return null;
  }
}
