/**
 * Aplica supabase/migrations/20260404230000_ensure_factura_electronica.sql al proyecto remoto.
 * npx tsx scripts/apply-sifen-factura-electronica-ensure.ts
 */
import { config } from "dotenv";
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

config({ path: join(process.cwd(), ".env.local") });

const { Client } = pg;

const MIGRATION = "20260404230000_ensure_factura_electronica.sql";

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
  const sqlPath = join(process.cwd(), "supabase", "migrations", MIGRATION);
  const sql = readFileSync(sqlPath, "utf-8");
  const url = getDbUrl();
  const client = new Client({
    connectionString: url,
    ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  const before = await client.query(`SELECT to_regclass('public.factura_electronica') AS fe, to_regclass('public.factura_electronica_evento') AS ev`);
  console.log("Antes: factura_electronica =", before.rows[0]?.fe ?? "null", "| evento =", before.rows[0]?.ev ?? "null");

  await client.query(sql);

  const after = await client.query(`SELECT to_regclass('public.factura_electronica') AS fe, to_regclass('public.factura_electronica_evento') AS ev`);
  console.log("Después: factura_electronica =", after.rows[0]?.fe, "| evento =", after.rows[0]?.ev);
  await client.end();
  console.log("OK:", MIGRATION);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
