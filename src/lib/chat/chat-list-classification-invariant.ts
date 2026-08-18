import {
  conversationBelongsToBotTab,
  type InboxBotClassificationInput,
} from "@/lib/chat/inbox-bot-tab-classification";
import { debugChatList } from "@/lib/chat/debug-log";

type ListVista = "inbox" | "bot" | "historial";

/** Invariante: cada fila open/pending del fetch base es Bot XOR Inbox (mutuamente excluyente). */
export function logChatListClassificationInvariant(params: {
  vista: ListVista;
  source: string;
  schema: string;
  empresa_id: string;
  totalAfterQuery: number;
  /** Filas tras split por pestaña */
  listAfterTabSplit: Record<string, unknown>[];
  botTabCount: number;
  baseRows: Record<string, unknown>[];
  classifyCtx: InboxBotClassificationInput;
}): void {
  const {
    vista,
    source,
    schema,
    empresa_id,
    totalAfterQuery,
    listAfterTabSplit,
    botTabCount,
    baseRows,
    classifyCtx,
  } = params;

  if (vista !== "inbox" && vista !== "bot") return;

  let botInBase = 0;
  const idsInBase = new Set<string>();
  let duplicateIds = 0;
  const botIdSet = new Set<string>();
  const nonBotIdSet = new Set<string>();

  for (const r of baseRows) {
    const id = String((r as { id?: unknown }).id ?? "").trim();
    if (id) {
      if (idsInBase.has(id)) duplicateIds++;
      idsInBase.add(id);
    }
    const isBot = conversationBelongsToBotTab(r, classifyCtx);
    if (isBot) {
      botInBase++;
      if (id) botIdSet.add(id);
    } else if (id) {
      nonBotIdSet.add(id);
    }
  }
  const notBotInBase = baseRows.length - botInBase;

  let ok = true;
  let detail: Record<string, unknown> = {};

  if (vista === "inbox") {
    const inboxShown = listAfterTabSplit.length;
    ok = inboxShown + botTabCount === totalAfterQuery && botTabCount === botInBase;
    detail = {
      inbox_shown: inboxShown,
      bot_excluded: botTabCount,
      bot_in_base: botInBase,
      not_bot_in_base: notBotInBase,
    };
  } else if (vista === "bot") {
    const botShown = listAfterTabSplit.length;
    ok = botShown === botTabCount && botShown === botInBase;
    detail = {
      bot_shown: botShown,
      not_bot_in_base: notBotInBase,
    };
  }

  const logPayload = {
    schema,
    empresa_id,
    source,
    vista,
    base_count: totalAfterQuery,
    bot_tab_count_reported: botTabCount,
    after_tab_split_count: listAfterTabSplit.length,
    ...detail,
  };

  const shownIdSet = new Set(
    listAfterTabSplit.map((r) => String((r as { id?: unknown }).id ?? "").trim()).filter(Boolean)
  );
  const sampleMissingIds: string[] = [];
  if (vista === "inbox") {
    for (const id of nonBotIdSet) {
      if (!shownIdSet.has(id)) sampleMissingIds.push(id);
      if (sampleMissingIds.length >= 10) break;
    }
  } else if (vista === "bot") {
    for (const id of botIdSet) {
      if (!shownIdSet.has(id)) sampleMissingIds.push(id);
      if (sampleMissingIds.length >= 10) break;
    }
  }

  const missingCount =
    vista === "inbox"
      ? Math.max(0, totalAfterQuery - (listAfterTabSplit.length + botTabCount))
      : Math.max(0, totalAfterQuery - (notBotInBase + botTabCount));

  if (ok && duplicateIds === 0) {
    debugChatList("[chat-list][classification-invariant]", logPayload);
    return;
  }

  console.warn("[chat-list][classification-invariant-failed]", {
    ...logPayload,
    missing_count: missingCount,
    duplicate_count: duplicateIds,
    sample_missing_ids: sampleMissingIds,
  });
}
