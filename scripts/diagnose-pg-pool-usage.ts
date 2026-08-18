/**
 * Stress ligero del pool global PG: muchas consultas concurrentes a un solo pool.
 * Uso: npx tsx scripts/diagnose-pg-pool-usage.ts
 * Requiere .env.local con SUPABASE_DB_URL / DIRECT_URL / DATABASE_URL.
 */
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config();
import {
  getChatPostgresConnectionString,
  getChatPostgresPool,
  getPgPoolConfigMax,
  isPgPoolExhaustionMessage,
  logPgPoolStats,
} from "../src/lib/supabase/chat-pg-pool";

async function main() {
  const url = getChatPostgresConnectionString();
  if (!url) {
    console.error("Sin URL de base (SUPABASE_DB_URL / DIRECT_URL / DATABASE_URL + password+URL).");
    process.exit(1);
  }
  const hasSecret = /:[^@/]+@/.test(url) || /password=/i.test(url);
  console.log("connection_string_source", hasSecret ? "set (oculto)" : "incompleto?");
  const pool = getChatPostgresPool();
  if (!pool) {
    console.error("getChatPostgresPool() null");
    process.exit(1);
  }

  const max = getPgPoolConfigMax();
  console.log("PG_POOL_MAX effective max per process:", max);

  const concurrent = max * 8;
  const tag = "diagnose-pg-pool-usage";

  const tasks = Array.from({ length: concurrent }, (_, i) =>
    pool!
      .query("SELECT $1::int as n, pg_sleep(0.02)", [i])
      .then(() => ({ ok: true as const, i }))
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false as const, i, msg: msg.slice(0, 240) };
      })
  );

  const results = await Promise.all(tasks);
  const failed = results.filter((r): r is { ok: false; i: number; msg: string } => !r.ok);
  const exhaustedCount = failed.filter((r) => isPgPoolExhaustionMessage(r.msg)).length;
  logPgPoolStats(tag, pool, { concurrent, failed: failed.length, exhausted_markers: exhaustedCount });

  if (failed.length) {
    console.log("sample_fail", failed.slice(0, 3));
  }

  if (exhaustedCount > 0) {
    console.error("Se detectó EMAXCONNSESSION o similar; subí el pooler en Supabase o usá transaction mode (6543) en Vercel.");
    process.exit(2);
  }

  console.log("OK: sin agotamiento aparente; totalCount", pool.totalCount, "idle", pool.idleCount);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
