/**
 * Aplica supabase/migrations/20260406150000_empresa_sifen_timbrado_fecha_inicio.sql al proyecto remoto.
 * Requiere en .env.local: SUPABASE_DB_URL o (SUPABASE_DB_PASSWORD + NEXT_PUBLIC_SUPABASE_URL)
 *
 * npx tsx scripts/apply-sifen-timbrado-fecha-inicio-migration.ts
 */
import { config } from "dotenv";
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

config({ path: join(process.cwd(), ".env.local") });

const { Client } = pg;

const MIGRATION = "20260406150000_empresa_sifen_timbrado_fecha_inicio.sql";

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
  const sqlPath = join(process.cwd(), "supabase", "migrations", MIGRATION);
  const sql = readFileSync(sqlPath, "utf-8");
  const url = getDbUrl();
  const client = new Client({
    connectionString: url,
    ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  const before = await client.query<{ col: string | null }>(
    `SELECT column_name AS col
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'empresa_sifen_config'
       AND column_name = 'timbrado_fecha_inicio_vigencia'`
  );
  console.log(
    "Antes: columna timbrado_fecha_inicio_vigencia =",
    before.rows[0]?.col ?? "(no existía)"
  );

  console.log("Ejecutando", MIGRATION, "...");
  await client.query(sql);

  const after = await client.query(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'empresa_sifen_config'
       AND column_name = 'timbrado_fecha_inicio_vigencia'`
  );
  console.log("Después:", after.rows[0] ?? "ERROR: columna no encontrada");

  await client.end();
  console.log("OK: migración aplicada.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
