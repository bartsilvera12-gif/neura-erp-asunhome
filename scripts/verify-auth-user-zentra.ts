/**
 * Verifica que la tabla zentra_erp.usuarios exista y tenga filas (login ERP).
 * npx tsx scripts/verify-auth-user-zentra.ts [email@opcional]
 */
import { config } from "dotenv";
import path from "node:path";
import pg from "pg";

config({ path: path.resolve(process.cwd(), ".env.local") });

const url =
  process.env.DIRECT_URL?.trim() ||
  process.env.DATABASE_URL?.trim() ||
  process.env.SUPABASE_DB_URL?.trim();

async function main() {
  const email = process.argv[2]?.trim();
  if (!url) {
    console.error("Sin DIRECT_URL / DATABASE_URL");
    process.exit(2);
  }
  const c = new pg.Client({
    connectionString: url,
    ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });
  await c.connect();
  try {
    const tbl = await c.query(
      `select table_schema from information_schema.tables
       where table_name = 'usuarios' and table_schema in ('zentra_erp', 'public')
       order by table_schema`
    );
    console.log("tablas usuarios:", tbl.rows);

    const n = await c.query(`select count(*)::int as n from zentra_erp.usuarios`);
    console.log("zentra_erp.usuarios count:", n.rows[0]?.n);

    if (email) {
      const z = await c.query(
        `select id::text, empresa_id::text, rol from zentra_erp.usuarios where email = $1`,
        [email]
      );
      console.log("zentra_erp.usuarios por email:", z.rows);
      const p = await c.query(
        `select exists(
           select 1 from information_schema.tables
           where table_schema = 'public' and table_name = 'usuarios'
         ) as ex`
      );
      if (p.rows[0]?.ex) {
        const pub = await c.query(`select id::text from public.usuarios where email = $1`, [email]);
        console.log("public.usuarios por email (legacy):", pub.rows);
      }
    }
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
