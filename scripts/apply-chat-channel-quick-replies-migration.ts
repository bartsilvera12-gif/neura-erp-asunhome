/**
 * Aplica supabase/migrations/20260501120000_chat_channel_quick_replies.sql
 * Verifica tablas/políticas en todos los esquemas donde exista chat_channels.
 *
 * npm run db:apply-chat-channel-quick-replies
 *
 * Usa SUPABASE_DB_URL desde .env.local (igual que otros scripts de migración).
 */
import { config } from "dotenv";
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const MIGRATION_FILE = "20260501120000_chat_channel_quick_replies.sql";

const envPath = join(process.cwd(), ".env.local");
config({ path: envPath, override: true });
if (!process.env.SUPABASE_DB_URL?.trim()) {
  console.warn("[apply-chat-channel-quick-replies] dotenv:", envPath, "→ SUPABASE_DB_URL aún vacío (¿definir en entorno?)");
}

async function verify(client: pg.PoolClient) {
  const tables = await client.query<{
    table_schema: string;
  }>(
    `SELECT DISTINCT table_schema
     FROM information_schema.tables
     WHERE table_name = 'chat_channel_quick_replies'
       AND table_type = 'BASE TABLE'
     ORDER BY 1`
  );

  const schemasWithChannels = await client.query<{ nspname: string }>(
    `SELECT DISTINCT n.nspname AS nspname
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relname = 'chat_channels'
       AND c.relkind = 'r'
       AND (
         n.nspname IN ('public', 'zentra_erp')
         OR n.nspname ~ '^er_[0-9a-f]{32}$'
         OR n.nspname LIKE 'erp\\_%' ESCAPE '\\'
       )
     ORDER BY 1`
  );

  console.log("\n--- Verificación ---");
  console.log("Esquemas con chat_channels:", schemasWithChannels.rows.map((r) => r.nspname).join(", ") || "(ninguno)");

  for (const sch of schemasWithChannels.rows.map((r) => r.nspname)) {
    const hasQr = tables.rows.some((t) => t.table_schema === sch);
    console.log(`  ${sch}: chat_channel_quick_replies=${hasQr ? "OK" : "FALTA"}`);
    if (!hasQr) continue;

    const cols = await client.query(
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'chat_channel_quick_replies'
       ORDER BY ordinal_position`,
      [sch]
    );
    const need = new Set([
      "id",
      "empresa_id",
      "channel_id",
      "title",
      "body",
      "sort_order",
      "is_active",
      "created_at",
      "updated_at",
    ]);
    const got = new Set(cols.rows.map((r: { column_name: string }) => r.column_name));
    const missing = [...need].filter((c) => !got.has(c));
    if (missing.length) console.warn(`    columnas faltantes en ${sch}:`, missing.join(", "));
    else console.log(`    columnas: OK (${cols.rows.length})`);

    const idx = await client.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'chat_channel_quick_replies' ORDER BY 1`,
      [sch]
    );
    console.log(`    índices (${idx.rows.length}):`, idx.rows.map((r) => r.indexname).join(", ") || "—");

    const pol = await client.query(
      `SELECT policyname, cmd FROM pg_policies WHERE schemaname = $1 AND tablename = 'chat_channel_quick_replies' ORDER BY 1`,
      [sch]
    );
    console.log(`    RLS políticas (${pol.rows.length}):`, pol.rows.map((r) => r.policyname).join(", ") || "—");
    if (pol.rows.length !== 4) {
      console.warn(`    ⚠ Se esperaban 4 políticas en ${sch}, hay ${pol.rows.length}`);
    }
  }

  const orphan = tables.rows.filter(
    (t) => !schemasWithChannels.rows.some((s) => s.nspname === t.table_schema)
  );
  if (orphan.length) {
    console.log("Esquemas con quick_replies sin chat_channels en bucle esperado:", orphan.map((o) => o.table_schema));
  }
}

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
    await verify(client);
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
