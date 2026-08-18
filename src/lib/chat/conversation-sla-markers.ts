import type { SupabaseAdmin } from "@/lib/chat/types";

/**
 * Primera respuesta humana del operador (mensaje saliente humano).
 * No cuenta mensajes del bot ni del contacto.
 */
export async function markFirstHumanOperatorReply(
  supabase: SupabaseAdmin,
  empresaId: string,
  conversationId: string,
  opts: { from_me: boolean; sender_type: string }
): Promise<void> {
  if (!opts.from_me) return;
  const st = (opts.sender_type || "").toLowerCase();
  if (st !== "human") return;

  const ts = new Date().toISOString();
  const { error } = await supabase
    .from("chat_conversations")
    .update({
      first_human_response_at: ts,
      updated_at: ts,
    })
    .eq("id", conversationId.trim())
    .eq("empresa_id", empresaId)
    .is("first_human_response_at", null);

  if (error) {
    console.warn("[conversation-sla-markers] markFirstHumanOperatorReply", error.message);
  }
}
