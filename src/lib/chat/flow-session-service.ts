import { ensureCentralChatFlowSessionMirror } from "@/lib/chat/central-chat-flow-session-mirror";
import type { SupabaseAdmin } from "@/lib/chat/types";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";

/**
 * Cierra todas las sesiones activas de la conversación (p. ej. antes de reinicio o cambio de flujo).
 */
export async function markConversationActiveSessionsEnded(
  supabase: SupabaseAdmin,
  empresaId: string,
  conversationId: string,
  endStatus: "restarted" | "abandoned" | "completed",
  reason: string
): Promise<void> {
  const endedAt = new Date().toISOString();
  const { error } = await supabase
    .from("chat_flow_sessions")
    .update({
      status: endStatus,
      ended_at: endedAt,
      end_reason: reason.slice(0, 500),
    })
    .eq("empresa_id", empresaId)
    .eq("conversation_id", conversationId)
    .eq("status", "active");
  if (error) {
    console.error("[flow-session] end_active_failed", { conversationId, message: error.message });
  }
}

export async function insertActiveFlowSessionRow(
  supabase: SupabaseAdmin,
  empresaId: string,
  conversationId: string,
  flowCode: string
): Promise<string | null> {
  const fc = flowCode.trim();
  if (!fc) return null;
  const { data, error } = await supabase
    .from("chat_flow_sessions")
    .insert({
      empresa_id: empresaId,
      conversation_id: conversationId,
      flow_code: fc,
      status: "active",
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[flow-runtime]", "chat_flow_sessions_insert_failed", {
      conversationId,
      empresaId,
      flowCode: fc,
      message: error?.message,
      code: (error as { code?: string })?.code,
      hint:
        typeof error?.message === "string" &&
        error.message.includes("chat_flow_sessions_conversation_id_fkey")
          ? "FK conversation_id suele apuntar a zentra_erp en lugar del chat_conversations tenant; migración 20260422100000"
          : undefined,
    });
    return null;
  }
  const sessionId = (data as { id: string }).id;
  await ensureCentralChatFlowSessionMirror({
    pool: getChatPostgresPool(),
    empresaId,
    sessionId,
  });
  return sessionId;
}

/**
 * Garantiza `chat_conversations.active_flow_session_id` coherente con `flow_code` y sesión `active`.
 */
export async function ensureActiveFlowSessionForConversation(
  supabase: SupabaseAdmin,
  empresaId: string,
  conversationId: string,
  flowCode: string | null | undefined
): Promise<string | null> {
  const fc = flowCode?.trim();
  if (!fc) return null;

  const { data: conv, error: cErr } = await supabase
    .from("chat_conversations")
    .select("active_flow_session_id, flow_code")
    .eq("id", conversationId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (cErr || !conv) return null;
  if (String(conv.flow_code ?? "").trim() !== fc) return null;

  const sid = (conv as { active_flow_session_id?: string | null }).active_flow_session_id;
  if (sid) {
    const { data: sess } = await supabase
      .from("chat_flow_sessions")
      .select("id, status, flow_code")
      .eq("id", sid)
      .maybeSingle();
    const s = sess as { id?: string; status?: string; flow_code?: string } | null;
    if (s && s.status === "active" && String(s.flow_code ?? "").trim() === fc) {
      return s.id ?? null;
    }
  }

  await markConversationActiveSessionsEnded(
    supabase,
    empresaId,
    conversationId,
    "abandoned",
    "ensure_active_session_recovered_stale_pointer"
  );

  const newId = await insertActiveFlowSessionRow(supabase, empresaId, conversationId, fc);
  if (!newId) return null;

  const { error: uErr } = await supabase
    .from("chat_conversations")
    .update({
      active_flow_session_id: newId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId)
    .eq("empresa_id", empresaId);
  if (uErr) {
    console.error("[flow-session] set_active_on_conversation_failed", uErr.message);
    return null;
  }
  return newId;
}
