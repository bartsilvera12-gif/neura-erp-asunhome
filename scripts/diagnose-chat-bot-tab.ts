/**
 * Diagnóstico pestaña Bot vs Inbox (Postgres + misma lógica que el listado).
 *
 * .env.local:
 *   SUPABASE_DB_URL | DIRECT_URL | DATABASE_URL
 *   CHAT_DIAGNOSE_EMPRESA_ID (uuid, obligatorio)
 *   CHAT_DIAGNOSE_SCHEMA (ej. erp_el_papu_store_5ad0bdda)
 *
 * Uso: npx tsx scripts/diagnose-chat-bot-tab.ts
 */
import { config } from "dotenv";
import path from "node:path";
import pg from "pg";
import {
  buildActiveFlowMatchSet,
  buildFlowSessionMap,
  explainConversationBotClassification,
  flowTokenMatchesActiveCatalog,
  type FlowSessionRowMin,
} from "../src/lib/chat/inbox-bot-tab-classification";

config({ path: path.resolve(process.cwd(), ".env.local") });

const url =
  process.env.SUPABASE_DB_URL?.trim() ||
  process.env.DIRECT_URL?.trim() ||
  process.env.DATABASE_URL?.trim();
const empresaId = process.env.CHAT_DIAGNOSE_EMPRESA_ID?.trim();
const schema = process.env.CHAT_DIAGNOSE_SCHEMA?.trim();

function bump(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

async function main() {
  if (!url) {
    console.error("Falta SUPABASE_DB_URL, DIRECT_URL o DATABASE_URL");
    process.exit(1);
  }
  if (!empresaId) {
    console.error("Falta CHAT_DIAGNOSE_EMPRESA_ID en .env.local");
    process.exit(1);
  }
  if (!schema) {
    console.error("Falta CHAT_DIAGNOSE_SCHEMA en .env.local (schema tenant, ej. erp_* )");
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

    console.log("[diagnose][active-flows]", {
      schema,
      empresa_id: empresaId,
      count: activeFlowRows.length,
      sample: activeFlowRows.slice(0, 8).map((r) => ({
        id: r.id,
        flow_code: r.flow_code,
        name: r.label.trim() || null,
        active: r.activo,
      })),
    });

    const convRes = await client.query(
      `
      SELECT
        id::text,
        status::text,
        human_taken_over,
        flow_status::text,
        flow_code::text,
        active_flow_session_id::text,
        channel_id::text
      FROM ${schema}.chat_conversations
      WHERE empresa_id = $1::uuid
        AND status IN ('open', 'pending')
      `,
      [empresaId]
    );
    const convRows = (convRes.rows ?? []) as Record<string, unknown>[];
    const openPending = convRows.length;

    const convIds = convRows.map((r) => String(r.id ?? "").trim()).filter(Boolean);

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

    const withActiveSession = convRows.filter((row) =>
      activeSessionByConversationId.has(String(row.id ?? "").trim())
    ).length;

    const classifyCtx = {
      activeFlowCodeSet: matchSet,
      sessionById,
      activeSessionByConversationId,
    };

    let botClassified = 0;
    const reasonHistogram: Record<string, number> = {};

    for (const row of convRows) {
      const ex = explainConversationBotClassification(row, classifyCtx);
      if (ex.isBot) botClassified++;
      else bump(reasonHistogram, ex.reason);
    }

    const sortedReasons = Object.entries(reasonHistogram)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);

    let withSessionFlowMatchingCatalog = 0;
    for (const row of convRows) {
      const cid = String(row.id ?? "").trim();
      const sess = activeSessionByConversationId.get(cid);
      if (sess && flowTokenMatchesActiveCatalog(sess.flow_code, matchSet)) withSessionFlowMatchingCatalog++;
    }

    console.log("[diagnose][summary]", {
      schema,
      empresa_id: empresaId,
      open_pending_conversations: openPending,
      conversations_with_active_running_session: withActiveSession,
      conversations_active_session_flow_matches_catalog: withSessionFlowMatchingCatalog,
      classified_bot_tab: botClassified,
      top_rejection_reasons: Object.fromEntries(sortedReasons),
    });

    const mismatchPreview = convRows
      .filter((row) => activeSessionByConversationId.has(String(row.id ?? "").trim()))
      .slice(0, 3)
      .map((row) => {
        const ex = explainConversationBotClassification(row, classifyCtx);
        return {
          conversation_id: String(row.id ?? "").trim(),
          reason_not_bot: ex.isBot ? null : ex.reason,
          resolved_session_flow:
            ex.resolvedSessionId && sessionById.get(ex.resolvedSessionId)
              ? sessionById.get(ex.resolvedSessionId)!.flow_code
              : activeSessionByConversationId.get(String(row.id ?? "").trim())?.flow_code ?? null,
        };
      });
    console.log("[diagnose][session-sample]", mismatchPreview);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
