/**
 * Ejecuta la migración RLS en Supabase.
 * Requiere: SUPABASE_DB_PASSWORD en .env.local
 * La contraseña está en: Supabase Dashboard > Project Settings > Database
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const { Client } = pg;

const PROJECT_REF = "ycyibjxplsgguuxbqtps";

function getDbUrl(): string {
  const url = process.env.SUPABASE_DB_URL;
  if (url) return url;
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password) {
    throw new Error(
      "Falta SUPABASE_DB_PASSWORD o SUPABASE_DB_URL. " +
        "Dashboard > Project Settings > Database > Connection string"
    );
  }
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${PROJECT_REF}.supabase.co:5432/postgres`;
}

async function main() {
  const sqlPath = join(
    process.cwd(),
    "supabase",
    "migrations",
    "20250312000000_rls_multiempresa.sql"
  );
  const sql = readFileSync(sqlPath, "utf-8");

  const client = new Client({ connectionString: getDbUrl() });
  try {
    await client.connect();
    console.log("Conectado a Supabase. Ejecutando migración RLS...");
    await client.query(sql);
    console.log("Migración ejecutada correctamente.");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
