/**
 * Humo SQL: INSERT + SELECT + DELETE en chat_channel_quick_replies por esquema
 * (conexión db directa asegura FK/trigger, sin sesión JWT).
 *
 * npm run db:verify-chat-quick-replies-smoke
 */
import { config } from "dotenv";
import { join } from "path";
import pg from "pg";

config({ path: join(process.cwd(), ".env.local"), override: true });

const MARKER = "__smoke_qr_verify__";

/** Identificador SQL citado (esquemas devueltos por pg_catalog). */
function qi(name: string) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

async function main() {
  const url = process.env.SUPABASE_DB_URL?.trim();
  if (!url) throw new Error("Falta SUPABASE_DB_URL");

  const pool = new pg.Pool({
    connectionString: url,
    ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
    max: 1,
  });

  const client = await pool.connect();
  try {
    const schemas = await client.query<{ nspname: string }>(
      `SELECT DISTINCT n.nspname
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relname = 'chat_channels'
         AND c.relkind = 'r'
         AND EXISTS (
           SELECT 1 FROM pg_class c2
           JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
           WHERE n2.nspname = n.nspname AND c2.relname = 'chat_channel_quick_replies' AND c2.relkind = 'r'
         )
         AND (
           n.nspname IN ('public', 'zentra_erp')
           OR n.nspname ~ '^er_[0-9a-f]{32}$'
           OR n.nspname LIKE 'erp\\_%' ESCAPE '\\'
         )
       ORDER BY 1`
    );

    for (const { nspname: sch } of schemas.rows) {
      const ch = await client.query<{ id: string; empresa_id: string }>(
        `SELECT id, empresa_id FROM ${qi(sch)}.chat_channels LIMIT 1`
      );
      if (ch.rows.length === 0) {
        console.log(`${sch}: sin chat_channels, omitido`);
        continue;
      }
      const { id: channelId, empresa_id: empresaId } = ch.rows[0];

      await client.query("BEGIN");
      try {
        const ins = await client.query<{ id: string }>(
          `INSERT INTO ${qi(sch)}.chat_channel_quick_replies
             (empresa_id, channel_id, title, body, sort_order, is_active)
           VALUES ($1, $2, $3, $4, 999, true)
           RETURNING id`,
          [empresaId, channelId, MARKER, "Texto de prueba humo"]
        );
        const id = ins.rows[0]?.id;
        if (!id) throw new Error("sin id");

        const sel = await client.query(
          `SELECT id FROM ${qi(sch)}.chat_channel_quick_replies WHERE id = $1`,
          [id]
        );
        if (sel.rowCount !== 1) throw new Error("select falló");

        await client.query(`DELETE FROM ${qi(sch)}.chat_channel_quick_replies WHERE id = $1`, [id]);
        await client.query("COMMIT");
        console.log(`${sch}: humo OK (insert/select/delete)`);
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }
    console.log("\nTodos los esquemas con canal probaron OK.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
