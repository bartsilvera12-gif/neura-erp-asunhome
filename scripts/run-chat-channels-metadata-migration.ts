/**
 * Migración: columnas nombre, provider, provider_channel_id, activo en chat_channels.
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
  if (!password) throw new Error("Falta SUPABASE_DB_PASSWORD o SUPABASE_DB_URL");
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${PROJECT_REF}.supabase.co:5432/postgres`;
}

async function main() {
  const sql = readFileSync(
    join(process.cwd(), "supabase", "migrations", "20250329000001_chat_channels_metadata.sql"),
    "utf-8"
  );
  const client = new Client({ connectionString: getDbUrl(), ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    console.log("Ejecutando migración chat_channels metadata...");
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
