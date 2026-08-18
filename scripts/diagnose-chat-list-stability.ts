/**
 * Estabilidad del listado omnicanal: invariante base = bot + inbox (misma lógica que el listado).
 *
 * Variables:
 *   SUPABASE_DB_URL | DIRECT_URL | DATABASE_URL
 *   CHAT_DIAGNOSE_EMPRESA_ID (uuid)
 *   CHAT_DIAGNOSE_SCHEMA (tenant)
 *
 * Uso:
 *   CHAT_DIAGNOSE_EMPRESA_ID=... CHAT_DIAGNOSE_SCHEMA=... npx tsx scripts/diagnose-chat-list-stability.ts
 */
import { config } from "dotenv";
import path from "node:path";
import pg from "pg";
import {
  buildActiveFlowMatchSet,
  buildFlowSessionMap,
  conversationBelongsToBotTab,
  explainConversationBotClassification,
  type FlowSessionRowMin,
} from "../src/lib/chat/inbox-bot-tab-classification";

config({ path: path.resolve(process.cwd(), ".env.local") });

const url =
  process.env.SUPABASE_DB_URL?.trim() ||
  process.env.DIRECT_URL?.trim() ||
  process.env.DATABASE_URL?.trim();
const empresaId = process.env.CHAT_DIAGNOSE_EMPRESA_ID?.trim();
const schema = process.env.CHAT_DIAGNOSE_SCHEMA?.trim();

async function main() {
  if (!url) {
    console.error("Falta SUPABASE_DB_URL, DIRECT_URL o DATABASE_URL");
    process.exit(1);
  }
  if (!empresaId) {
    console.error("Falta CHAT_DIAGNOSE_EMPRESA_ID");
    process.exit(1);
  }
  if (!schema) {
    console.error("Falta CHAT_DIAGNOSE_SCHEMA");
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString: url,
    ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  try {
    const flowRes = await client.query(
      `
      SELECT id::text AS id, flow_code::text AS flow_code, COALESCE(label, '')::text AS label,
             COALESCE(activo, false) AS activo
      FROM ${schema}.chat_flows
      WHERE empresa_id = $1::uuid AND COALESCE(activo, false) = true
      `,
      [empresaId]
    );
    const activeFlowRows = (flowRes.rows ?? []) as {
      id: string;
      flow_code: string;
      label: string;
      activo: boolean;
    }[];
    const matchSet = buildActiveFlowMatchSet(activeFlowRows);

    const convRes = await client.query(
      `
      SELECT
        id::text,
        status::text,
        human_taken_over,
        flow_status::text,
        flow_code::text,
        active_flow_session_id::text,
        channel_id::text,
        queue_id::text,
        assigned_agent_id::text
      FROM ${schema}.chat_conversations
      WHERE empresa_id = $1::uuid
        AND status IN ('open','pending')
      `,
      [empresaId]
    );
    const baseRows = (convRes.rows ?? []) as Record<string, unknown>[];
    const totalBase = baseRows.length;

    const convIds = baseRows.map((r) => String(r.id ?? "").trim()).filter(Boolean);

    const sessionById = new Map<string, FlowSessionRowMin>();
    const activeSessionByConversationId = new Map<string, FlowSessionRowMin>();
    const ST = ["active", "running"];
    const chunk = 150;
    for (let i = 0; i < convIds.length; i += chunk) {
      const part = convIds.slice(i, i + chunk);
      const sRes = await client.query(
        `
        SELECT id::text, status::text, flow_code::text, conversation_id::text
        FROM ${schema}.chat_flow_sessions
        WHERE empresa_id = $1::uuid
          AND conversation_id = ANY($2::uuid[])
          AND lower(trim(status)) = ANY($3::text[])
        `,
        [empresaId, part, ST]
      );
      const rows = (sRes.rows ?? []) as FlowSessionRowMin[];
      for (const [k, v] of buildFlowSessionMap(rows).entries()) {
        sessionById.set(k, v);
      }
      for (const r of rows) {
        const cid = String(r.conversation_id ?? "").trim();
        if (!cid) continue;
        const m = sessionById.get(String(r.id ?? "").trim());
        if (m) activeSessionByConversationId.set(cid, m);
      }
    }

    const classifyCtx = {
      activeFlowCodeSet: matchSet,
      sessionById,
      activeSessionByConversationId,
    };

    let bot = 0;
    let inbox = 0;

    for (const row of baseRows) {
      if (conversationBelongsToBotTab(row, classifyCtx)) bot++;
      else inbox++;
    }

    const invariantOk = bot + inbox === totalBase;

    const sample = baseRows.slice(0, 10).map((row) => {
      const ex = explainConversationBotClassification(row, classifyCtx);
      return {
        id: String(row.id ?? "").trim(),
        is_bot_tab: ex.isBot,
        status: String(row.status ?? ""),
        reason_not_bot: ex.isBot ? null : ex.reason,
      };
    });

    console.log("[diagnose-chat-list-stability]", {
      schema,
      empresa_id: empresaId,
      active_flow_catalog: activeFlowRows.length,
      total_base_open_pending: totalBase,
      classified_bot: bot,
      classified_inbox: inbox,
      invariant_base_equals_bot_plus_inbox: invariantOk,
      note:
        "Sin filtro de alcance de usuario. Igual que lista solo si el alcance no excluye conversaciones.",
    });

    if (!invariantOk) {
      console.warn("[diagnose-chat-list-stability][classification-invariant-failed]", {
        base_count: totalBase,
        bot_count: bot,
        inbox_count: inbox,
        missing_count: totalBase - bot - inbox,
      });
    }

    console.log("[diagnose-chat-list-stability][sample]", sample);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
