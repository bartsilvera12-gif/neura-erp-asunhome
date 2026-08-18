import type { Pool } from "pg";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { buildFlowSessionMap, type FlowSessionRowMin } from "@/lib/chat/inbox-bot-tab-classification";

const ACTIVE_SESSION_STATUSES = ["active", "running"] as const;

/**
 * Carga sesiones con status activo para las conversaciones del listado y las fusiona en `sessionById`.
 * Rellena `activeSessionByConversationId` (una fila activa por conversación en esquema normalizado).
 */
export async function loadActiveFlowSessionsByConversationForInboxList(
  supabase: AppSupabaseClient,
  empresaId: string,
  conversationRows: Record<string, unknown>[],
  sessionById: Map<string, FlowSessionRowMin>
): Promise<Map<string, FlowSessionRowMin>> {
  const convIds = [
    ...new Set(
      conversationRows
        .map((r) => String((r as { id?: unknown }).id ?? "").trim())
        .filter((id) => id.length > 0)
    ),
  ];
  const byConversation = new Map<string, FlowSessionRowMin>();
  const chunk = 100;
  for (let i = 0; i < convIds.length; i += chunk) {
    const part = convIds.slice(i, i + chunk);
    const { data, error } = await supabase
      .from("chat_flow_sessions")
      .select("id, status, flow_code, conversation_id")
      .eq("empresa_id", empresaId)
      .in("conversation_id", part)
      .in("status", [...ACTIVE_SESSION_STATUSES]);
    if (error) {
      console.warn("[chat-list] chat_flow_sessions por conversación:", error.message);
      continue;
    }
    for (const [k, v] of buildFlowSessionMap(data as FlowSessionRowMin[]).entries()) {
      sessionById.set(k, v);
    }
    for (const r of data ?? []) {
      const row = r as { id?: string; conversation_id?: string | null };
      const cid = String(row.conversation_id ?? "").trim();
      if (!cid) continue;
      const m = sessionById.get(String(row.id ?? "").trim());
      if (m) byConversation.set(cid, m);
    }
  }
  return byConversation;
}

export async function loadActiveFlowSessionsByConversationForInboxListPg(
  pool: Pool,
  dataSchema: string,
  empresaId: string,
  conversationRows: Record<string, unknown>[],
  sessionById: Map<string, FlowSessionRowMin>
): Promise<Map<string, FlowSessionRowMin>> {
  const sessQt = quoteSchemaTable(dataSchema, "chat_flow_sessions");
  const convIds = [
    ...new Set(
      conversationRows
        .map((r) => String((r as { id?: unknown }).id ?? "").trim())
        .filter((id) => id.length > 0)
    ),
  ];
  const byConversation = new Map<string, FlowSessionRowMin>();
  const chunk = 100;
  for (let i = 0; i < convIds.length; i += chunk) {
    const part = convIds.slice(i, i + chunk);
    try {
      const qr = await pool.query(
        `
        SELECT id::text, status::text, flow_code::text, conversation_id::text
        FROM ${sessQt}
        WHERE empresa_id = $1::uuid
          AND conversation_id = ANY($2::uuid[])
          AND lower(trim(status)) = ANY($3::text[])
      `,
        [empresaId, part, [...ACTIVE_SESSION_STATUSES]]
      );
      const rows = (qr.rows ?? []) as FlowSessionRowMin[];
      for (const [k, v] of buildFlowSessionMap(rows).entries()) {
        sessionById.set(k, v);
      }
      for (const r of rows) {
        const cid = String(r.conversation_id ?? "").trim();
        if (!cid) continue;
        const m = sessionById.get(String(r.id ?? "").trim());
        if (m) byConversation.set(cid, m);
      }
    } catch (e) {
      console.warn("[chat-list] pg chat_flow_sessions por conversación:", e instanceof Error ? e.message : e);
    }
  }
  return byConversation;
}
