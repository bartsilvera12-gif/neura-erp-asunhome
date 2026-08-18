import { config } from "dotenv";
import path from "node:path";
import pg from "pg";

config({ path: path.resolve(process.cwd(), ".env.local") });

const url =
  process.env.DIRECT_URL?.trim() ||
  process.env.DATABASE_URL?.trim() ||
  process.env.SUPABASE_DB_URL?.trim();

async function main() {
  if (!url) process.exit(2);
  const c = new pg.Client({
    connectionString: url,
    ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });
  await c.connect();
  const q = `
    SELECT
      n.nspname AS src_schema,
      cl.relname AS src_table,
      con.conname,
      nr.nspname AS ref_schema,
      cr.relname AS ref_table,
      pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    JOIN pg_class cr ON cr.oid = con.confrelid
    JOIN pg_namespace nr ON nr.oid = cr.relnamespace
    WHERE con.contype = 'f'
      AND nr.nspname = 'public'
      AND (n.nspname = 'zentra_erp' OR n.nspname ~ '^erp_[a-z0-9_]+$')
    ORDER BY 1, 2, 3
  `;
  const r = await c.query(q);
  console.log("total_fks_to_public:", r.rows.length);
  console.log(JSON.stringify(r.rows.slice(0, 15), null, 2));
  if (r.rows.length > 15) console.log("... y", r.rows.length - 15, "más");
  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
