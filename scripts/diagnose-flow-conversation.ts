/**
 * Diagnóstico puntual: conversación + opción + FK (Postgres).
 *
 * .env.local: SUPABASE_DB_URL | DIRECT_URL | DATABASE_URL
 * CHAT_DIAGNOSE_EMPRESA_ID, CHAT_DIAGNOSE_SCHEMA
 *
 * Opcional: CHAT_DIAGNOSE_CONVERSATION_ID, CHAT_DIAGNOSE_OPTION_ID
 *
 * npx tsx scripts/diagnose-flow-conversation.ts
 */
import { config } from "dotenv";
import path from "node:path";
import pg from "pg";
import {
  buildActiveFlowMatchSet,
  buildFlowSessionMap,
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
const conversationId =
  process.env.CHAT_DIAGNOSE_CONVERSATION_ID?.trim() ||
  "5abb9f49-e708-4e43-ba42-694f39d216e4";
const optionId =
  process.env.CHAT_DIAGNOSE_OPTION_ID?.trim() || "aba5bca2-082e-40e1-b30a-ccbc9bc7873e";

async function main() {
  if (!url) {
    console.error("Falta SUPABASE_DB_URL, DIRECT_URL o DATABASE_URL");
    process.exit(1);
  }
  if (!empresaId || !schema) {
    console.error("Faltan CHAT_DIAGNOSE_EMPRESA_ID o CHAT_DIAGNOSE_SCHEMA");
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString: url,
    ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  try {
    const conv = await client.query(
      `
      SELECT id::text, empresa_id::text, channel_id::text, status::text, human_taken_over,
             flow_status::text, flow_code::text, active_flow_session_id::text, updated_at
      FROM ${schema}.chat_conversations
      WHERE id = $1::uuid AND empresa_id = $2::uuid
      `,
      [conversationId, empresaId]
    );
    console.log("[conv]", conv.rows[0] ?? null);

    const sessions = await client.query(
      `
      SELECT id::text, conversation_id::text, flow_code::text, status::text,
             created_at
      FROM ${schema}.chat_flow_sessions
      WHERE conversation_id = $1::uuid AND empresa_id = $2::uuid
      ORDER BY created_at DESC NULLS LAST
      LIMIT 5
      `,
      [conversationId, empresaId]
    );
    console.log("[sessions]", sessions.rows);

    const optTenant = await client.query(
      `SELECT id::text, node_id::text, label::text, meta_button_id::text, option_value::text
       FROM ${schema}.chat_flow_options WHERE id = $1::uuid`,
      [optionId]
    );
    console.log("[chat_flow_options tenant]", optTenant.rows);

    try {
      const optZ = await client.query(
        `SELECT id::text, node_id::text FROM zentra_erp.chat_flow_options WHERE id = $1::uuid`,
        [optionId]
      );
      console.log("[chat_flow_options zentra_erp]", optZ.rows);
    } catch (e) {
      console.log("[chat_flow_options zentra_erp] (skip)", e instanceof Error ? e.message : e);
    }

    const ev = await client.query(
      `
      SELECT id::text, event_type::text, selected_option_id::text, node_code::text, created_at
      FROM ${schema}.chat_flow_events
      WHERE conversation_id = $1::uuid AND empresa_id = $2::uuid
      ORDER BY created_at DESC NULLS LAST
      LIMIT 8
      `,
      [conversationId, empresaId]
    );
    console.log("[recent events]", ev.rows);

    const fk = await client.query(
      `
      SELECT c.conname, pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = $1 AND t.relname = 'chat_flow_events' AND c.contype = 'f'
        AND pg_get_constraintdef(c.oid) LIKE '%chat_flow_options%'
      `,
      [schema]
    );
    console.log("[fk chat_flow_events → chat_flow_options]", fk.rows);

    const flowCat = await client.query(
      `SELECT id::text, flow_code::text, COALESCE(label, '')::text AS label
       FROM ${schema}.chat_flows
       WHERE empresa_id = $1::uuid AND COALESCE(activo, false) = true`,
      [empresaId]
    );
    const matchSet = buildActiveFlowMatchSet(flowCat.rows);

    const sessActive = await client.query(
      `
      SELECT id::text, status::text, flow_code::text, conversation_id::text
      FROM ${schema}.chat_flow_sessions
      WHERE empresa_id = $1::uuid
        AND conversation_id = $2::uuid
        AND lower(trim(status)) = ANY($3::text[])
      `,
      [empresaId, conversationId, ["active", "running"]]
    );
    const pointer = String((conv.rows[0] as { active_flow_session_id?: string } | undefined)?.active_flow_session_id ?? "").trim();
    const sessionIds = [...new Set([pointer, ...sessActive.rows.map((r: { id?: string }) => String(r.id ?? "").trim())].filter(Boolean))];
    const sessionById = new Map<string, FlowSessionRowMin>();
    if (sessionIds.length > 0) {
      const sr = await client.query(
        `
        SELECT id::text, status::text, flow_code::text, conversation_id::text
        FROM ${schema}.chat_flow_sessions
        WHERE empresa_id = $1::uuid AND id = ANY($2::uuid[])
        `,
        [empresaId, sessionIds]
      );
      for (const [k, v] of buildFlowSessionMap(sr.rows as FlowSessionRowMin[]).entries()) {
        sessionById.set(k, v);
      }
    }
    const activeSessionByConversationId = new Map<string, FlowSessionRowMin>();
    for (const r of sessActive.rows as FlowSessionRowMin[]) {
      const cid = String(r.conversation_id ?? "").trim();
      const id = String(r.id ?? "").trim();
      const row = sessionById.get(id);
      if (cid && row) activeSessionByConversationId.set(cid, row);
    }

    const convRecord = (conv.rows[0] ?? {}) as Record<string, unknown>;
    const ex = explainConversationBotClassification(convRecord, {
      activeFlowCodeSet: matchSet,
      sessionById,
      activeSessionByConversationId,
    });
    console.log("[bot-inbox classification]", {
      isBot: ex.isBot,
      reason: ex.reason,
      resolved_session_id: ex.resolvedSessionId,
      flags: ex.flags,
      flow_token_matches_catalog: ex.flags.runningFlowInCatalog,
    });
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
