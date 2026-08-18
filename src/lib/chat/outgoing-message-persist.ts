import type { AppSupabaseClient } from "@/lib/supabase/schema";

export type MinimalConversationForPersist = {
  id: string;
  empresa_id: string;
};

/**
 * Persiste mensaje saliente + preview conversación (mismo contrato que flow-engine interno).
 */
export async function persistOutgoingChatMessage(
  supabase: AppSupabaseClient,
  input: {
    conversation: MinimalConversationForPersist;
    content: string;
    messageType: string;
    waMessageId: string | null;
    raw: unknown;
    senderType: "system" | "human" | "ai";
    automationSource: string;
  }
): Promise<void> {
  const ts = new Date().toISOString();
  await supabase.from("chat_messages").insert({
    empresa_id: input.conversation.empresa_id,
    conversation_id: input.conversation.id,
    wa_message_id: input.waMessageId,
    from_me: true,
    sender_type: input.senderType,
    automation_source: input.automationSource,
    message_type: input.messageType,
    content: input.content,
    raw_payload: (input.raw ?? {}) as Record<string, unknown>,
  });
  await supabase
    .from("chat_conversations")
    .update({
      last_message_at: ts,
      last_message_preview: input.content.slice(0, 280),
      updated_at: ts,
    })
    .eq("id", input.conversation.id);
}
