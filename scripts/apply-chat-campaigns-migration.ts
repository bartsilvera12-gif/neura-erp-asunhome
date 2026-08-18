/**
 * Aplica supabase/migrations/20260530130000_chat_campaigns_mvp.sql
 * npm run db:apply-chat-campaigns-migration
 */
import { config } from "dotenv";
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const MIGRATION_FILE = "20260530130000_chat_campaigns_mvp.sql";

const envPath = join(process.cwd(), ".env.local");
config({ path: envPath, override: true });

async function main() {
  const url = process.env.SUPABASE_DB_URL?.trim();
  if (!url) {
    throw new Error("Falta SUPABASE_DB_URL en .env.local");
  }
  const sql = readFileSync(join(process.cwd(), "supabase", "migrations", MIGRATION_FILE), "utf-8");

  const pool = new pg.Pool({
    connectionString: url,
    ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
    max: 1,
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log("OK: migración aplicada:", MIGRATION_FILE);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
