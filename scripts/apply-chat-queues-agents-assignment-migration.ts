/**
 * Aplica supabase/migrations/20260408120000_chat_queues_agents_assignment.sql
 * Usa SUPABASE_DB_URL desde .env.local
 *
 * npx tsx scripts/apply-chat-queues-agents-assignment-migration.ts
 */
import { config } from "dotenv";
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

config({ path: join(process.cwd(), ".env.local") });

const FILE = "20260408120000_chat_queues_agents_assignment.sql";

async function main() {
  const url = process.env.SUPABASE_DB_URL?.trim();
  if (!url) {
    throw new Error("Falta SUPABASE_DB_URL en .env.local");
  }
  const sql = readFileSync(join(process.cwd(), "supabase", "migrations", FILE), "utf-8");
  const client = new pg.Client({
    connectionString: url,
    ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  try {
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
