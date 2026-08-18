/**
 * Ejecuta migraciones de usuarios (auth_user_id y usuario_modulos).
 * Requiere: SUPABASE_DB_PASSWORD o SUPABASE_DB_URL en .env.local
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

const MIGRATIONS = [
  "20250324000001_usuarios_auth_user_id.sql",
  "20250324000002_usuario_modulos.sql",
  "20250326000001_usuarios_poblar_auth_user_id.sql",
  "20250326000002_usuarios_telefono_fecha.sql",
];

async function main() {
  const client = new Client({ connectionString: getDbUrl() });
  try {
    await client.connect();
    console.log("Conectado a Supabase. Ejecutando migraciones de usuarios...\n");
    for (const name of MIGRATIONS) {
      const sqlPath = join(process.cwd(), "supabase", "migrations", name);
      const sql = readFileSync(sqlPath, "utf-8");
      console.log(`Ejecutando ${name}...`);
      await client.query(sql);
      console.log(`  ✓ ${name} OK`);
    }
    console.log("\nMigraciones ejecutadas correctamente.");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
