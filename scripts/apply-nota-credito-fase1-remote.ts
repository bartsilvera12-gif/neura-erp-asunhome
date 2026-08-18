/**
 * Ejecuta supabase/migrations/20260421100000_nota_credito_fase1.sql contra la BD
 * de .env.local (SUPABASE_DB_URL). Idempotente respecto al DDL (IF NOT EXISTS).
 *
 * No registra en schema_migrations: hacelo después con:
 *   npx tsx scripts/repair-remote-supabase-migration-history.ts --only=20260421100000
 *
 * npx tsx scripts/apply-nota-credito-fase1-remote.ts
 */
import { config } from "dotenv";
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

config({ path: join(process.cwd(), ".env.local") });

const FILE = "20260421100000_nota_credito_fase1.sql";

function getDbUrl(): string {
  const direct = process.env.SUPABASE_DB_URL?.trim();
  if (direct) return direct;
  const password = process.env.SUPABASE_DB_PASSWORD?.trim();
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const m = base?.match(/https:\/\/([^.]+)\.supabase\.co/i);
  if (!password || !m?.[1]) {
    throw new Error(
      "Falta SUPABASE_DB_URL o (SUPABASE_DB_PASSWORD + NEXT_PUBLIC_SUPABASE_URL) en .env.local"
    );
  }
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${m[1]}.supabase.co:5432/postgres`;
}

async function main() {
  const sql = readFileSync(join(process.cwd(), "supabase", "migrations", FILE), "utf-8");
  const url = getDbUrl();
  const client = new pg.Client({
    connectionString: url,
    ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  console.log("Aplicando", FILE, "…");
  await client.query(sql);
  await client.end();
  console.log("OK DDL:", FILE);
  console.log("Registrar historial: npx tsx scripts/repair-remote-supabase-migration-history.ts --only=20260421100000");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
