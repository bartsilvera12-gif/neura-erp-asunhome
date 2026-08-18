/**
 * Ejecuta un archivo SQL de supabase/migrations contra la DB remota.
 * Variables (.env.local): SUPABASE_DB_URL o SUPABASE_DB_PASSWORD + NEXT_PUBLIC_SUPABASE_URL
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const { Client } = pg;

function getDbUrl(): string {
  const url = process.env.SUPABASE_DB_URL;
  if (url?.trim()) return url.trim();
  const password = process.env.SUPABASE_DB_PASSWORD;
  const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!password || !publicUrl) {
    throw new Error(
      "Definí SUPABASE_DB_URL, o bien SUPABASE_DB_PASSWORD + NEXT_PUBLIC_SUPABASE_URL en .env.local"
    );
  }
  let host: string;
  try {
    host = new URL(publicUrl).hostname;
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL inválida");
  }
  const ref = host.replace(/\.supabase\.co$/i, "");
  if (!ref || ref === host) {
    throw new Error("No se pudo derivar el project ref desde NEXT_PUBLIC_SUPABASE_URL");
  }
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`;
}

async function main() {
  const rel = process.argv[2];
  if (!rel) {
    console.error("Uso: npx tsx scripts/run-migration-file.ts <ruta-sql>");
    process.exit(1);
  }
  const sqlPath = join(process.cwd(), rel);
  const sql = readFileSync(sqlPath, "utf-8");

  const conn = getDbUrl();
  const client = new Client({
    connectionString: conn,
    ssl: conn.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });
  try {
    await client.connect();
    console.log("Conectado. Ejecutando:", rel);
    await client.query(sql);
    console.log("OK.");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
