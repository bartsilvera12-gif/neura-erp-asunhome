/** Lista FK chat_flow_events → chat_flow_options que aún apuntan a zentra_erp (debe quedar vacío tras migración). */
import { config } from "dotenv";
import path from "node:path";
import pg from "pg";

config({ path: path.resolve(process.cwd(), ".env.local") });

const url =
  process.env.SUPABASE_DB_URL?.trim() ||
  process.env.DIRECT_URL?.trim() ||
  process.env.DATABASE_URL?.trim();

async function main() {
  if (!url) throw new Error("Falta URL DB");
  const client = new pg.Client({
    connectionString: url,
    ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  try {
    const bad = await client.query(`
      SELECT n.nspname AS tenant_schema, c.conname,
             pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_class rt ON rt.oid = c.confrelid
      JOIN pg_namespace rn ON rn.oid = rt.relnamespace
      WHERE c.contype = 'f'
        AND t.relname = 'chat_flow_events'
        AND rt.relname = 'chat_flow_options'
        AND rn.nspname = 'zentra_erp'
        AND (n.nspname ~ '^erp_' OR n.nspname ~ '^er_[0-9a-f]{32}$')
    `);
    console.log("[fk_aun_a_zentra_erp_options] count=", bad.rows.length, bad.rows);

    const local = await client.query(`
      SELECT n.nspname AS tenant_schema, c.conname,
             pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_class rt ON rt.oid = c.confrelid
      JOIN pg_namespace rn ON rn.oid = rt.relnamespace
      WHERE c.contype = 'f'
        AND t.relname = 'chat_flow_events'
        AND rt.relname = 'chat_flow_options'
        AND n.nspname = rn.nspname
        AND (n.nspname ~ '^erp_' OR n.nspname ~ '^er_[0-9a-f]{32}$')
      ORDER BY n.nspname
    `);
    console.log("[fk_local_options] count=", local.rows.length);
    console.log(local.rows.slice(0, 25));
    if (local.rows.length > 25) console.log("... y", local.rows.length - 25, "más");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
