/**
 * Aplica supabase/migrations/20260402100000_comprobante_monto_vs_flujo.sql al remoto.
 * Usa SUPABASE_DB_URL desde .env.local
 *
 * npx tsx scripts/apply-comprobante-monto-vs-flujo-migration.ts
 */
import { config } from "dotenv";
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

config({ path: join(process.cwd(), ".env.local") });

const FILE = "20260402100000_comprobante_monto_vs_flujo.sql";

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
  const ref = m[1];
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`;
}

async function main() {
  const migrationsDir = join(process.cwd(), "supabase", "migrations");
  const sql = readFileSync(join(migrationsDir, FILE), "utf-8");
  const url = getDbUrl();
  const client = new pg.Client({
    connectionString: url,
    ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  console.log("Aplicando", FILE, "…");
  await client.query(sql);
  await client.end();
  console.log("OK:", FILE);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
