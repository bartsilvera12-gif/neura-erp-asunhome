/**
 * Aplica un archivo .sql a Postgres (p. ej. remoto Supabase) usando SUPABASE_DB_URL de .env.local
 *
 * Uso:  node scripts/apply-migration-file-pg.cjs supabase/migrations/XXXX_....sql
 */
const fs = require("fs");
const path = require("path");
const { config } = require("dotenv");
const pg = require("pg");

const fileArg = process.argv[2];
if (!fileArg) {
  console.error("Uso: node scripts/apply-migration-file-pg.cjs <ruta-al-archivo.sql>");
  process.exit(2);
}

config({ path: path.resolve(process.cwd(), ".env.local") });
const url = process.env.SUPABASE_DB_URL?.trim();
if (!url) {
  console.error("Falta SUPABASE_DB_URL en .env.local");
  process.exit(2);
}

const sql = fs.readFileSync(path.resolve(process.cwd(), fileArg), "utf8");

async function main() {
  const c = new pg.Client({
    connectionString: url,
    ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });
  await c.connect();
  try {
    await c.query(sql);
    console.log("Migración aplicada OK:", fileArg);
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
