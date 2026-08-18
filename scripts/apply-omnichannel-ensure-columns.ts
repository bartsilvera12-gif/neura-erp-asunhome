/**
 * Aplica migraciones idempotentes de columnas omnicanal (public + zentra_erp + tenant er_*).
 * Usa SUPABASE_DB_URL desde .env.local
 *
 * npm run db:apply-omnichannel-ensure
 */
import { config } from "dotenv";
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

config({ path: join(process.cwd(), ".env.local") });

const FILES = [
  "20260416100000_ensure_omnichannel_etapa1_columns.sql",
  "20260417120000_chat_queues_etapa1_columns_all_schemas.sql",
  "20260418130000_omnichannel_queue_routing_and_bridge.sql",
  "20260419120000_chat_routing_runtime_engine.sql",
];

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
    for (const FILE of FILES) {
      const sql = readFileSync(join(process.cwd(), "supabase", "migrations", FILE), "utf-8");
      await client.query(sql);
      console.log("OK:", FILE);
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
