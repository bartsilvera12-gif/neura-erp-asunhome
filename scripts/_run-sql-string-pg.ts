import { config } from "dotenv";
import path from "node:path";
import pg from "pg";

config({ path: path.resolve(process.cwd(), ".env.local") });

const url =
  process.env.SUPABASE_DB_URL?.trim() ||
  process.env.DIRECT_URL?.trim() ||
  process.env.DATABASE_URL?.trim();

const sql = process.argv.slice(2).join(" ").trim();
if (!url || !sql) {
  console.error("Uso: npx tsx scripts/_run-sql-string-pg.ts \"SQL...\"");
  process.exit(2);
}

async function main() {
  const client = new pg.Client({
    connectionString: url,
    ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  try {
    const r = await client.query(sql);
    console.log(JSON.stringify({ rowCount: r.rowCount, rows: r.rows }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
