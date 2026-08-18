/**
 * Compatibilidad: re-exporta tipos/helpers y delega en la clasificación unificada Inbox/Bot.
 */

import {
  conversationBelongsToBotTab,
  type FlowSessionRowMin,
  type InboxBotClassificationInput,
  buildFlowSessionMap,
} from "@/lib/chat/inbox-bot-tab-classification";

export type { FlowSessionRowMin };
export { buildFlowSessionMap };

/**
 * @deprecated Prefer `conversationBelongsToBotTab` (`inbox-bot-tab-classification`).
 */
export function isActivelyBotHandledConversation(
  conv: Record<string, unknown>,
  activeFlowCodeSet: Set<string>,
  sessionById: Map<string, FlowSessionRowMin>,
  activeSessionByConversationId?: Map<string, FlowSessionRowMin>
): boolean {
  const ctx: InboxBotClassificationInput = {
    activeFlowCodeSet,
    sessionById,
    activeSessionByConversationId,
  };
  return conversationBelongsToBotTab(conv, ctx);
}
