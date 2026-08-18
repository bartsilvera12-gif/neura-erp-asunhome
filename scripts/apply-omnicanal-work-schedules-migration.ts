/**
 * Aplica migración de horarios omnicanal y preferencias de usuario (todos los esquemas con chat_queues).
 * Requiere SUPABASE_DB_URL en .env.local
 *
 * npm run db:apply-omnicanal-work-schedules
 */
import { config } from "dotenv";
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

config({ path: join(process.cwd(), ".env.local") });

const FILE = "20260502120000_omnicanal_work_schedules_usuario_prefs.sql";

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
