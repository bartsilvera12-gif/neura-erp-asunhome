/**
 * Repara datos: copia `chat_conversations` tenant → `zentra_erp.chat_conversations` (mismo UUID).
 *
 *   npx tsx scripts/mirror-tenant-chat-conversation-to-zentra.ts --schema <erp_*> --empresa <uuid> --conversation <uuid>
 */
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

async function main() {
  const argv = process.argv;
  function arg(name: string): string | undefined {
    const i = argv.indexOf(name);
    if (i >= 0 && argv[i + 1]) return argv[i + 1].trim();
    return undefined;
  }

  const schema = arg("--schema");
  const empresa = arg("--empresa");
  const conversation = arg("--conversation");
  if (!schema || !empresa || !conversation) {
    console.error(
      "Uso: npx tsx scripts/mirror-tenant-chat-conversation-to-zentra.ts --schema <erp_*> --empresa <uuid> --conversation <uuid>"
    );
    process.exit(1);
  }

  const { ensureCentralChatConversationMirror } = await import(
    "../src/lib/chat/central-chat-conversation-mirror"
  );
  const { getChatPostgresPool } = await import("../src/lib/supabase/chat-pg-pool");

  const pool = getChatPostgresPool();
  if (!pool) {
    console.error("No hay pool Postgres: definí SUPABASE_DB_URL / DIRECT_URL / DATABASE_URL en .env.local");
    process.exit(1);
  }

  await ensureCentralChatConversationMirror({
    pool,
    tenantDataSchema: schema,
    empresaId: empresa,
    conversationId: conversation,
  });

  const central = await pool.query(
    `SELECT id, empresa_id, channel_id, contact_id, flow_code, flow_status
     FROM zentra_erp.chat_conversations
     WHERE id = $1::uuid AND empresa_id = $2::uuid
     LIMIT 1`,
    [conversation, empresa]
  );

  const row = central.rows[0] as
    | {
        id: string;
        empresa_id: string;
        channel_id: string;
        contact_id: string;
        flow_code: string | null;
        flow_status: string | null;
      }
    | undefined;

  console.log(
    JSON.stringify(
      {
        ok: Boolean(row?.id),
        schema,
        empresa_id: empresa,
        conversation_id: conversation,
        channel_id: row?.channel_id ?? null,
        contact_id: row?.contact_id ?? null,
        flow_code: row?.flow_code ?? null,
        flow_status: row?.flow_status ?? null,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
