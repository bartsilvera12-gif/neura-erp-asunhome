/**
 * Diagnóstico local contra Postgres (misma URL que el pool: SUPABASE_DB_URL | DIRECT_URL | DATABASE_URL).
 * No imprime secretos.
 *
 * Uso:
 *   npx tsx scripts/diagnose-sorteos-kpis.ts <empresa_uuid> <schema>
 *
 * Ejemplo Papu Store:
 *   npx tsx scripts/diagnose-sorteos-kpis.ts 5ad0bdda-f94f-446c-9032-1fedf34e8479 erp_el_papu_store_5ad0bdda
 */
import pg from "pg";
import { config } from "dotenv";
import { join } from "path";
import { asuncionDayBoundsUtc, asuncionMonthBoundsUtc } from "../src/lib/sorteos/kpis-time-bounds";

config({ path: join(process.cwd(), ".env.local"), quiet: true });

function connString(): string | null {
  return (
    process.env.SUPABASE_DB_URL?.trim() ||
    process.env.DIRECT_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    null
  );
}

async function main() {
  const empresaId = process.argv[2]?.trim();
  const schema = process.argv[3]?.trim();
  if (!empresaId || !schema) {
    console.error("Uso: npx tsx scripts/diagnose-sorteos-kpis.ts <empresa_uuid> <schema>");
    process.exit(1);
  }
  const url = connString();
  if (!url) {
    console.error("Falta SUPABASE_DB_URL, DIRECT_URL o DATABASE_URL en .env.local");
    process.exit(1);
  }

  const pool = new pg.Pool({
    connectionString: url,
    max: 1,
    ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });

  const tent = `"${schema.replace(/"/g, '""')}"."sorteo_entradas"`;
  const tcup = `"${schema.replace(/"/g, '""')}"."sorteo_cupones"`;
  const day = asuncionDayBoundsUtc();
  const month = asuncionMonthBoundsUtc();

  try {
    const q = async (label: string, sql: string, params: unknown[]) => {
      const r = await pool.query(sql, params);
      console.log(label, r.rows?.[0] ?? r.rows);
    };

    await q(
      "COUNT entradas (total)",
      `SELECT COUNT(*)::bigint AS n FROM ${tent} WHERE empresa_id = $1::uuid`,
      [empresaId]
    );
    await q(
      "COUNT cupones (total)",
      `SELECT COUNT(*)::bigint AS n FROM ${tcup} WHERE empresa_id = $1::uuid`,
      [empresaId]
    );

    await q(
      "COUNT entradas mes PY (no rechazado)",
      `SELECT COUNT(*)::bigint AS n FROM ${tent} e
       WHERE e.empresa_id = $1::uuid AND e.created_at >= $2::timestamptz AND e.created_at <= $3::timestamptz
       AND e.estado_pago <> 'rechazado'`,
      [empresaId, month.start, month.end]
    );
    await q(
      "SUM monto mes PY",
      `SELECT COALESCE(SUM(e.monto_total), 0)::numeric AS s FROM ${tent} e
       WHERE e.empresa_id = $1::uuid AND e.created_at >= $2::timestamptz AND e.created_at <= $3::timestamptz
       AND e.estado_pago <> 'rechazado'`,
      [empresaId, month.start, month.end]
    );
    await q(
      "COUNT cupones JOIN entradas mes PY",
      `SELECT COUNT(c.id)::bigint AS n FROM ${tcup} c
       INNER JOIN ${tent} e ON e.id = c.entrada_id
       WHERE e.empresa_id = $1::uuid AND e.created_at >= $2::timestamptz AND e.created_at <= $3::timestamptz
       AND e.estado_pago <> 'rechazado'`,
      [empresaId, month.start, month.end]
    );

    await q(
      "COUNT entradas hoy PY",
      `SELECT COUNT(*)::bigint AS n FROM ${tent} e
       WHERE e.empresa_id = $1::uuid AND e.created_at >= $2::timestamptz AND e.created_at <= $3::timestamptz
       AND e.estado_pago <> 'rechazado'`,
      [empresaId, day.start, day.end]
    );
    await q(
      "SUM monto hoy PY",
      `SELECT COALESCE(SUM(e.monto_total), 0)::numeric AS s FROM ${tent} e
       WHERE e.empresa_id = $1::uuid AND e.created_at >= $2::timestamptz AND e.created_at <= $3::timestamptz
       AND e.estado_pago <> 'rechazado'`,
      [empresaId, day.start, day.end]
    );
    await q(
      "COUNT cupones JOIN entradas hoy PY",
      `SELECT COUNT(c.id)::bigint AS n FROM ${tcup} c
       INNER JOIN ${tent} e ON e.id = c.entrada_id
       WHERE e.empresa_id = $1::uuid AND e.created_at >= $2::timestamptz AND e.created_at <= $3::timestamptz
       AND e.estado_pago <> 'rechazado'`,
      [empresaId, day.start, day.end]
    );

    console.log("Ventanas (ISO UTC):", { day, month });
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
