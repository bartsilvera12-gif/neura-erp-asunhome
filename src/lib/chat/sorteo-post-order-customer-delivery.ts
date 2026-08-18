import "server-only";

import { getConversationFlowState } from "@/lib/chat/flow-engine-service";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { resolveOutboundTextContextFromIds, sendOutboundTextMessage } from "@/lib/chat/outbound-send-dispatch";
import { persistOutgoingChatMessage } from "@/lib/chat/outgoing-message-persist";
import { buildSorteoOrderFlowVarOverrides } from "@/lib/sorteos/sorteo-order-from-chat";
import type { EnsureSorteoOrderCreatedData } from "@/lib/sorteos/sorteo-order-from-chat";
import { isSorteoFinalTicketNode } from "@/lib/chat/sorteo-final-ticket-node";
import {
  getSorteoTicketDeliveryModeForSorteo,
  runSorteoTicketAfterFinalNodeMessage,
  shouldSuppressSorteoFinalTextAfterImageOnlyTicket,
} from "@/lib/sorteos/sorteo-ticket-delivery";
import type { SorteoTicketDeliveryMode } from "@/lib/sorteos/sorteo-ticket-types";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Reutiliza el patrón `no_next_node` del flow-engine: resumen + ticket según modo del sorteo.
 * No avanza el flujo ni modifica `flow_current_node`.
 */
export async function deliverSorteoPostOrderToCustomer(input: {
  supabase: AppSupabaseClient;
  empresaId: string;
  conversationId: string;
  contactId: string;
  channelId: string;
  flowSessionId: string;
  orderResult: EnsureSorteoOrderCreatedData;
  flowData: Record<string, string>;
  automationSource: "sorteo_manual_approval" | "flow_engine";
}): Promise<{ textSent: boolean; ticketError?: string; textError?: string }> {
  const sorteoOrderMerge = buildSorteoOrderFlowVarOverrides(input.orderResult);
  const isFinalSummary = isSorteoFinalTicketNode(null, { flowEndedWithOrderSummary: true });
  let suppressSummary = false;
  let modeNoNext: SorteoTicketDeliveryMode = "text_only";

  if (isFinalSummary) {
    modeNoNext = await getSorteoTicketDeliveryModeForSorteo({
      supabase: input.supabase,
      empresaId: input.empresaId,
      sorteoId: input.orderResult.sorteoId,
    });
    if (modeNoNext === "image_only") {
      const { delivery } = await runSorteoTicketAfterFinalNodeMessage({
        supabase: input.supabase,
        empresaId: input.empresaId,
        conversationId: input.conversationId,
        contactId: input.contactId,
        channelId: input.channelId,
        flowSessionId: input.flowSessionId,
        orderResult: input.orderResult,
        flowData: input.flowData,
      });
      suppressSummary = shouldSuppressSorteoFinalTextAfterImageOnlyTicket(delivery);
    }
  }

  const st = await getConversationFlowState(input.supabase, input.conversationId);
  if (!st) {
    return { textSent: false, textError: "conversación no encontrada" };
  }
  const schema = await fetchDataSchemaForEmpresaId(input.empresaId);
  const outbound = await resolveOutboundTextContextFromIds(
    input.supabase,
    { contactId: input.contactId, channelId: input.channelId },
    { dataSchema: schema }
  );

  const no = sorteoOrderMerge.numero_orden ?? "";
  const cup = sorteoOrderMerge.numeros_cupon ?? "";
  const summary = `Listo. Tu orden Nº ${no}. Cupones: ${cup}.`;
  let textSent = false;
  let textError: string | undefined;
  if (!suppressSummary) {
    const sendSum = await sendOutboundTextMessage(outbound, summary);
    if (sendSum.ok) {
      await persistOutgoingChatMessage(input.supabase, {
        conversation: { id: st.id, empresa_id: st.empresa_id },
        content: summary,
        messageType: "text",
        waMessageId: sendSum.waMessageId,
        raw: sendSum.raw,
        senderType: "system",
        automationSource: input.automationSource,
      });
      textSent = true;
    } else {
      textError = sendSum.error;
    }
  } else {
    textSent = true;
  }

  let ticketError: string | undefined;
  if (isFinalSummary && modeNoNext === "text_and_image") {
    try {
      const { delivery } = await runSorteoTicketAfterFinalNodeMessage({
        supabase: input.supabase,
        empresaId: input.empresaId,
        conversationId: input.conversationId,
        contactId: input.contactId,
        channelId: input.channelId,
        flowSessionId: input.flowSessionId,
        orderResult: input.orderResult,
        flowData: input.flowData,
      });
      if (delivery && !delivery.ok && !delivery.skipped) {
        ticketError = delivery.reason ?? "ticket_error";
      }
    } catch (e) {
      ticketError = e instanceof Error ? e.message : "ticket_exception";
    }
  }

  if (isFinalSummary && modeNoNext === "text_only" && !textSent && !suppressSummary) {
    return { textSent: false, textError: textError ?? "send_failed" };
  }

  return { textSent, textError, ticketError };
}
