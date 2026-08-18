/**
 * Creación de conversación WhatsApp con flujo activo de la empresa (mismo criterio que el webhook Meta).
 */
import { assignConversation } from "@/lib/chat/assign-conversation-service";
import { ensureCentralChatConversationMirror } from "@/lib/chat/central-chat-conversation-mirror";
import { insertActiveFlowSessionRow } from "@/lib/chat/flow-session-service";
import { flowTrace } from "@/lib/chat/flow-trace-log";
import {
  getFirstActiveNodeCodeForFlow,
  listActiveWhatsappFlowsForEmpresa,
} from "@/lib/chat/resolve-whatsapp-active-flow";
import type { SupabaseAdmin } from "@/lib/chat/types";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";

async function mirrorTenantChatConversationToCentralCatalog(
  empresaId: string,
  conversationId: string
): Promise<void> {
  const tenantDataSchema = await fetchDataSchemaForEmpresaId(empresaId);
  await ensureCentralChatConversationMirror({
    pool: getChatPostgresPool(),
    tenantDataSchema,
    empresaId,
    conversationId,
  });
}

export type WhatsappConversationRow = {
  id: string;
  status: string;
  unread_count: number;
  flow_code: string | null;
  flow_current_node: string | null;
  flow_status: string;
  human_taken_over: boolean;
  active_flow_session_id: string | null;
};

/**
 * Inserta `chat_conversations` para (contacto, canal) con boot de flujo si hay un único flujo activo.
 * Maneja carrera 23505 releyendo la fila existente.
 */
export async function createWhatsappConversationWithActiveFlow(
  supabase: SupabaseAdmin,
  empresaId: string,
  channelId: string,
  contactId: string
): Promise<{ conv: WhatsappConversationRow | null; error: string | null }> {
  const catalogNew = await listActiveWhatsappFlowsForEmpresa(supabase, empresaId);
  let flowCodeIns: string | null = null;
  let nodeIns: string | null = null;
  if (catalogNew.kind === "single") {
    flowCodeIns = catalogNew.flowCode;
    nodeIns =
      (await getFirstActiveNodeCodeForFlow(supabase, empresaId, flowCodeIns)) ?? "inicio";
    console.info("[whatsapp-conversation-bootstrap]", "resolved_active_flow", {
      context: "new_conversation_insert",
      empresaId,
      flowCode: flowCodeIns,
      flow_current_node: nodeIns,
      ambiguous: catalogNew.ambiguous,
      allActiveCodes: catalogNew.allActiveCodes,
    });
  } else {
    console.warn("[whatsapp-conversation-bootstrap]", "no_active_flow_found", {
      context: "new_conversation_insert",
      empresaId,
    });
  }

  let wasNewInsert = false;
  const { data: conv, error: convErr } = await supabase
    .from("chat_conversations")
    .insert({
      empresa_id: empresaId,
      channel_id: channelId,
      contact_id: contactId,
      status: "open",
      flow_code: flowCodeIns,
      flow_current_node: nodeIns,
      flow_status: "bot",
      human_taken_over: false,
      last_message_at: null,
      last_message_preview: null,
      unread_count: 0,
    })
    .select(
      "id, status, unread_count, flow_code, flow_current_node, flow_status, human_taken_over, active_flow_session_id"
    )
    .single();

  if (conv && !convErr) wasNewInsert = true;

  if (conv?.id) {
    await mirrorTenantChatConversationToCentralCatalog(empresaId, conv.id);
  }

  let existingConv: WhatsappConversationRow | null = conv as WhatsappConversationRow | null;

  if (conv && flowCodeIns) {
    const bootSid = await insertActiveFlowSessionRow(supabase, empresaId, conv.id, flowCodeIns);
    if (bootSid) {
      await supabase
        .from("chat_conversations")
        .update({ active_flow_session_id: bootSid, updated_at: new Date().toISOString() })
        .eq("id", conv.id)
        .eq("empresa_id", empresaId);
      flowTrace("new_conversation_flow_session_bootstrapped", {
        conversation_id: conv.id,
        empresa_id: empresaId,
        flow_code: flowCodeIns,
        new_flow_session_id: bootSid,
        event: "post_insert_bootstrap",
      });
    }
    const { data: fresh } = await supabase
      .from("chat_conversations")
      .select(
        "id, status, unread_count, flow_code, flow_current_node, flow_status, human_taken_over, active_flow_session_id"
      )
      .eq("id", conv.id)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (fresh) existingConv = fresh as WhatsappConversationRow;
  } else if (convErr?.code === "23505") {
    wasNewInsert = false;
    const { data: again } = await supabase
      .from("chat_conversations")
      .select(
        "id, status, unread_count, flow_code, flow_current_node, flow_status, human_taken_over, active_flow_session_id"
      )
      .eq("contact_id", contactId)
      .eq("channel_id", channelId)
      .maybeSingle();
    if (again?.id) {
      await mirrorTenantChatConversationToCentralCatalog(empresaId, again.id);
    }
    existingConv = again as WhatsappConversationRow | null;
  } else if (convErr) {
    return { conv: null, error: convErr.message };
  }

  if (wasNewInsert && existingConv?.id) {
    const ar = await assignConversation(supabase, existingConv.id);
    if (!ar.ok) {
      console.warn("[whatsapp-conversation-bootstrap] assignConversation", ar.error);
    }
  }

  return { conv: existingConv, error: null };
}
