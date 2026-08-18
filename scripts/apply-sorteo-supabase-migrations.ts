/**
 * Aplica migraciones SQL críticas de sorteo + chat_flow_data contra Supabase remoto.
 * Usa SUPABASE_DB_URL o SUPABASE_DB_PASSWORD + NEXT_PUBLIC_SUPABASE_URL desde .env.local
 *
 * npx tsx scripts/apply-sorteo-supabase-migrations.ts
 */
import { config } from "dotenv";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import pg from "pg";

config({ path: join(process.cwd(), ".env.local") });

const { Client } = pg;

/** Migraciones a aplicar en orden (idempotentes donde aplica). */
const MIGRATION_FILES = [
  "20260328120000_sorteo_entradas_order_chat_idempotency.sql",
  "20260328130100_sorteo_entradas_promo_pricing.sql",
  "20260329140000_chat_flow_data_unique_per_flow.sql",
  "20260329150000_sorteo_finalize_confirm_payload.sql",
  "20260330180000_chat_flow_sessions.sql",
  "20260331130000_chat_comprobante_validaciones.sql",
] as const;

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

function verifyMigrationFilesExist(dir: string) {
  const names = new Set(readdirSync(dir).filter((f) => f.endsWith(".sql")));
  for (const f of MIGRATION_FILES) {
    if (!names.has(f)) throw new Error(`No existe migración: ${f}`);
  }
}

async function main() {
  const migrationsDir = join(process.cwd(), "supabase", "migrations");
  verifyMigrationFilesExist(migrationsDir);

  const url = getDbUrl();
  const client = new Client({
    connectionString: url,
    ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  console.log("Conectado a Supabase. Aplicando migraciones sorteo/chat_flow_data...");

  let hadError = false;
  for (const file of MIGRATION_FILES) {
    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    try {
      await client.query(sql);
      console.log("OK:", file);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("ERROR:", file, msg);
      hadError = true;
    }
  }
  await client.end();
  if (hadError) {
    console.error(
      "\nAlgunas migraciones fallaron (p. ej. ya aplicadas parcialmente). Revisá el mensaje arriba."
    );
    process.exit(1);
  }
  console.log("Todas las migraciones listadas se ejecutaron sin error.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
