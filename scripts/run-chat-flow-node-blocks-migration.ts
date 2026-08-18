/**
 * Migración: bloques compuestos por nodo de flujo.
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
    join(process.cwd(), "supabase", "migrations", "20260326110000_chat_flow_node_blocks.sql"),
    "utf-8"
  );
  const client = new Client({ connectionString: getDbUrl(), ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    console.log("Ejecutando migración chat_flow_node_blocks...");
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
