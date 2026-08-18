/**
 * Aplica migración idempotente `operational_status` en chat_agents (todos los schemas).
 * Usa SUPABASE_DB_URL desde .env.local
 *
 * npx tsx scripts/apply-chat-agents-operational-status.ts
 */
import { config } from "dotenv";
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

config({ path: join(process.cwd(), ".env.local") });

const FILE = "20260430160000_chat_agents_operational_status.sql";

async function main() {
  const url = process.env.SUPABASE_DB_URL?.trim();
  if (!url) {
    throw new Error("Falta SUPABASE_DB_URL en .env.local");
  }
  const client = new pg.Client({
    connectionString: url,
    ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  try {
    const sql = readFileSync(join(process.cwd(), "supabase", "migrations", FILE), "utf-8");
    await client.query(sql);
    console.log("OK:", FILE);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
