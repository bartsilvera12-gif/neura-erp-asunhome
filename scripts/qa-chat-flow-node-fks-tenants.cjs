/**
 * Valida que en cada schema tenant (er_*, erp_*) las FKs node_id de
 * chat_flow_node_blocks y chat_flow_options apunten a chat_flow_nodes del MISMO schema,
 * no a zentra_erp.chat_flow_nodes (causa típica de chat_flow_node_blocks_node_id_fkey al crear bloques).
 *
 * Uso: node scripts/qa-chat-flow-node-fks-tenants.cjs
 * Requiere SUPABASE_DB_URL en .env.local
 */
const path = require("path");
const { config } = require("dotenv");
const pg = require("pg");
config({ path: path.resolve(process.cwd(), ".env.local") });
const url = process.env.SUPABASE_DB_URL?.trim();
if (!url) {
  console.error("Falta SUPABASE_DB_URL en .env.local");
  process.exit(2);
}

async function main() {
  const c = new pg.Client({
    connectionString: url,
    ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });
  await c.connect();
  try {
    const r = await c.query(`
      SELECT
        tn.nspname::text AS tenant_schema,
        cf.relname::text AS from_table,
        c.conname::text AS conname,
        rn.nspname::text AS ref_schema,
        rt.relname::text AS ref_table,
        pg_get_constraintdef(c.oid, true) AS def
      FROM pg_constraint c
      JOIN pg_class cf ON cf.oid = c.conrelid
      JOIN pg_namespace tn ON tn.oid = cf.relnamespace
      JOIN pg_class rt ON rt.oid = c.confrelid
      JOIN pg_namespace rn ON rn.oid = rt.relnamespace
      WHERE c.contype = 'f'
        AND cf.relname IN ('chat_flow_node_blocks', 'chat_flow_options')
        AND rt.relname = 'chat_flow_nodes'
        AND rn.nspname = 'zentra_erp'
        AND (
          tn.nspname ~ '^er_[0-9a-f]{32}$'
          OR tn.nspname ~ '^erp_[a-zA-Z0-9_]+$'
        )
      ORDER BY tn.nspname, cf.relname, c.conname
    `);

    if (r.rows.length === 0) {
      console.log("OK: ningún tenant tiene node_id → zentra_erp.chat_flow_nodes (bloques/opciones).");
      process.exit(0);
    }

    console.error("ERROR: FKs node_id aún apuntan a zentra_erp en estos tenants:\n");
    for (const row of r.rows) {
      console.error(`  ${row.tenant_schema}.${row.from_table} :: ${row.conname}`);
      console.error(`    ${row.def}\n`);
    }
    console.error(
      "Aplicá supabase/migrations/20260522120000_fix_tenant_chat_flow_node_fks_to_local_nodes.sql (PG directo o migraciones)."
    );
    process.exit(1);
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
