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
  if (!password) throw new Error("Falta SUPABASE_DB_PASSWORD en .env.local");
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${PROJECT_REF}.supabase.co:5432/postgres`;
}

async function main() {
  const client = new Client({ connectionString: getDbUrl() });
  await client.connect();
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20250326000001_usuarios_poblar_auth_user_id.sql"), "utf-8");
  await client.query(sql);
  console.log("auth_user_id poblado en usuarios existentes.");
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
