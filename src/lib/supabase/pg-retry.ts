/**
 * Helper de reintento ante EMAXCONNSESSION (pool de Supabase agotado).
 * Hace UN reintento corto con backoff de 350ms. Solo reintenta este error
 * especifico para no enmascarar problemas reales.
 */
import type { Pool, QueryResultRow } from "pg";

export async function queryWithRetry<R extends QueryResultRow = QueryResultRow>(
  pool: Pool,
  sql: string,
  params: unknown[]
): Promise<{ rows: R[] }> {
  try {
    return await pool.query<R>(sql, params);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (/EMAXCONNSESSION|max clients reached|too many connections/i.test(msg)) {
      await new Promise((r) => setTimeout(r, 350));
      return await pool.query<R>(sql, params);
    }
    throw err;
  }
}
