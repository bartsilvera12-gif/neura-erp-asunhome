/**
 * Clasificación mutuamente excluyente Inbox vs pestaña Bot (omnicanal).
 *
 * - Bot: automatización vigente (sesión de flujo activa coherente, flujo publicado activo).
 * - Inbox: todo lo demás abierto/pendiente (humano, sin bot, sin flujo, sesión inválida, etc.).
 *
 * La sesión puede resolverse por `chat_conversations.active_flow_session_id` o, si el puntero
 * falta o está stale, por la única fila `chat_flow_sessions` con status active para esa conversación.
 */

export type FlowSessionRowMin = {
  id: string;
  status: string;
  flow_code: string;
  conversation_id: string;
};

export function buildFlowSessionMap(rows: FlowSessionRowMin[] | null | undefined): Map<string, FlowSessionRowMin> {
  const m = new Map<string, FlowSessionRowMin>();
  for (const r of rows ?? []) {
    const id = String(r.id ?? "").trim();
    if (!id) continue;
    m.set(id, {
      id,
      status: String(r.status ?? "").trim(),
      flow_code: String(r.flow_code ?? "").trim(),
      conversation_id: String(r.conversation_id ?? "").trim(),
    });
  }
  return m;
}

export type InboxBotClassificationInput = {
  /**
   * Tokens que identifican flujos activos en catálogo: `chat_flows.flow_code` y `chat_flows.id` (texto),
   * en forma original y en minúsculas (coincidencia con sesiones que guardan UUID o slug distinto).
   */
  activeFlowCodeSet: Set<string>;
  sessionById: Map<string, FlowSessionRowMin>;
  /**
   * Sesión activa por `conversation_id` (desambigua puntero ausente/stale en `chat_conversations`).
   * Debe poblarse en listados con `SELECT ... WHERE conversation_id IN (...) AND status = 'active'`.
   */
  activeSessionByConversationId?: Map<string, FlowSessionRowMin>;
};

export type BotClassificationExplanation = {
  isBot: boolean;
  reason: string;
  /** Sesión aplicada tras resolver puntero o lookup por conversación. */
  resolvedSessionId: string | null;
  flags: {
    humanTakenOver: boolean;
    flowStatus: string;
    hasActiveFlowSessionId: boolean;
    hasActiveSessionInTable: boolean;
    hasChannelFlow: boolean;
    statusOpenOrPending: boolean;
    sessionMatchesConversation: boolean;
    runningFlowInCatalog: boolean;
    sessionStatus: string | null;
    resolutionPath: "pointer" | "conversation_lookup" | "none";
  };
};

/** Estados que cuentan como sesión “en ejecución” para la pestaña Bot (además de `active`). */
const SESSION_STATUS_BOT_ACTIVE = new Set(["active", "running"]);

/** `flow_status` en conversación que indica automatización cuando no hay puntero/sesión resuelta. */
const FLOW_STATUS_BOTISH = new Set(["bot", "active", "running"]);

export function buildActiveFlowMatchSet(
  rows: { id?: string | null; flow_code?: string | null }[] | null | undefined
): Set<string> {
  const s = new Set<string>();
  for (const r of rows ?? []) {
    const id = String(r.id ?? "").trim();
    const fc = String(r.flow_code ?? "").trim();
    if (id) {
      s.add(id);
      s.add(id.toLowerCase());
    }
    if (fc) {
      s.add(fc);
      s.add(fc.toLowerCase());
    }
  }
  return s;
}

export function flowTokenMatchesActiveCatalog(token: string | null | undefined, matchSet: Set<string>): boolean {
  const t = String(token ?? "").trim();
  if (!t) return false;
  if (matchSet.has(t)) return true;
  return matchSet.has(t.toLowerCase());
}

function normalizeSessionStatus(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase();
}

function isSessionStatusBotActive(statusRaw: string): boolean {
  const s = normalizeSessionStatus(statusRaw);
  return SESSION_STATUS_BOT_ACTIVE.has(s);
}

/**
 * Resuelve la sesión de flujo aplicable: puntero en conversación o lookup por conversation_id.
 */
export function resolveFlowSessionForClassification(
  conv: Record<string, unknown>,
  ctx: InboxBotClassificationInput
): { session: FlowSessionRowMin | null; resolutionPath: "pointer" | "conversation_lookup" | "none" } {
  const conversationId = String(conv.id ?? "").trim();
  const pointerId = String(conv.active_flow_session_id ?? "").trim();

  if (pointerId) {
    const byPointer = ctx.sessionById.get(pointerId);
    if (byPointer && String(byPointer.conversation_id ?? "").trim() === conversationId) {
      return { session: byPointer, resolutionPath: "pointer" };
    }
  }

  if (conversationId && ctx.activeSessionByConversationId?.has(conversationId)) {
    const byConv = ctx.activeSessionByConversationId.get(conversationId)!;
    return { session: byConv, resolutionPath: "conversation_lookup" };
  }

  return { session: null, resolutionPath: "none" };
}

function activeSessionInMap(conv: Record<string, unknown>, ctx: InboxBotClassificationInput): boolean {
  const cid = String(conv.id ?? "").trim();
  return Boolean(cid && ctx.activeSessionByConversationId?.has(cid));
}

function emptyFlags(partial?: Partial<BotClassificationExplanation["flags"]>): BotClassificationExplanation["flags"] {
  return {
    humanTakenOver: partial?.humanTakenOver ?? false,
    flowStatus: partial?.flowStatus ?? "",
    hasActiveFlowSessionId: partial?.hasActiveFlowSessionId ?? false,
    hasActiveSessionInTable: partial?.hasActiveSessionInTable ?? false,
    hasChannelFlow: partial?.hasChannelFlow ?? false,
    statusOpenOrPending: partial?.statusOpenOrPending ?? false,
    sessionMatchesConversation: partial?.sessionMatchesConversation ?? false,
    runningFlowInCatalog: partial?.runningFlowInCatalog ?? false,
    sessionStatus: partial?.sessionStatus ?? null,
    resolutionPath: partial?.resolutionPath ?? "none",
  };
}

function evaluateBotConversation(
  conv: Record<string, unknown>,
  ctx: InboxBotClassificationInput
): BotClassificationExplanation {
  const status = String(conv.status ?? "").trim().toLowerCase();
  const statusOk = status === "open" || status === "pending";
  const humanTakenOver = Boolean(conv.human_taken_over);
  const flowStatusRaw = String(conv.flow_status ?? "").trim();
  const flowStatus = flowStatusRaw.toLowerCase();
  const pointerId = String(conv.active_flow_session_id ?? "").trim();
  const convFlow = String(conv.flow_code ?? "").trim();
  const hasCompanyFlows = ctx.activeFlowCodeSet.size > 0;
  const hasChannelFlow =
    hasCompanyFlows && Boolean(convFlow) && flowTokenMatchesActiveCatalog(convFlow, ctx.activeFlowCodeSet);

  const baseFlags = emptyFlags({
    humanTakenOver,
    flowStatus: flowStatusRaw,
    hasActiveFlowSessionId: pointerId.length > 0,
    hasChannelFlow,
    statusOpenOrPending: statusOk,
  });

  if (!statusOk) {
    return { isBot: false, reason: "status_not_open_or_pending", resolvedSessionId: null, flags: baseFlags };
  }
  if (humanTakenOver) {
    return { isBot: false, reason: "human_taken_over", resolvedSessionId: null, flags: baseFlags };
  }
  if (flowStatus === "human") {
    return { isBot: false, reason: "flow_status_human", resolvedSessionId: null, flags: baseFlags };
  }
  if (!hasCompanyFlows) {
    return { isBot: false, reason: "no_active_flows_in_catalog", resolvedSessionId: null, flags: baseFlags };
  }

  const conversationId = String(conv.id ?? "").trim();
  if (!conversationId) {
    return { isBot: false, reason: "missing_conversation_id", resolvedSessionId: null, flags: baseFlags };
  }

  const { session, resolutionPath } = resolveFlowSessionForClassification(conv, ctx);

  if (!session) {
    if (FLOW_STATUS_BOTISH.has(flowStatus) && hasChannelFlow) {
      return {
        isBot: true,
        reason: "ok_bot_tab_flow_status_channel_no_resolved_session",
        resolvedSessionId: null,
        flags: emptyFlags({
          ...baseFlags,
          hasActiveSessionInTable: activeSessionInMap(conv, ctx),
          resolutionPath,
        }),
      };
    }
    return {
      isBot: false,
      reason: pointerId ? "active_flow_session_row_missing_or_mismatch" : "no_active_flow_session_for_conversation",
      resolvedSessionId: null,
      flags: emptyFlags({
        ...baseFlags,
        hasActiveSessionInTable: activeSessionInMap(conv, ctx),
        resolutionPath,
      }),
    };
  }

  const sessStatus = String(session.status ?? "").trim();
  const sessConv = String(session.conversation_id ?? "").trim();
  const sessionMatchesConversation = sessConv === conversationId;

  const sessFlow = String(session.flow_code ?? "").trim();
  const runningFlow = sessFlow || convFlow;
  const catalogOk = Boolean(runningFlow && flowTokenMatchesActiveCatalog(runningFlow, ctx.activeFlowCodeSet));

  const flags = emptyFlags({
    ...baseFlags,
    hasActiveSessionInTable: true,
    sessionMatchesConversation,
    sessionStatus: sessStatus,
    resolutionPath,
    runningFlowInCatalog: catalogOk,
  });

  if (!sessionMatchesConversation) {
    return { isBot: false, reason: "session_conversation_id_mismatch", resolvedSessionId: session.id, flags };
  }

  if (!isSessionStatusBotActive(sessStatus)) {
    return {
      isBot: false,
      reason: `session_status_not_bot_active:${normalizeSessionStatus(sessStatus) || "empty"}`,
      resolvedSessionId: session.id,
      flags,
    };
  }

  /** Sesión active/running en esta conversación: Bot aunque el token no coincida con catálogo (FK/eventos/flows editados). */
  return {
    isBot: true,
    reason: catalogOk ? "ok_bot_tab" : "ok_bot_tab_active_session",
    resolvedSessionId: session.id,
    flags,
  };
}

export function aggregateBotClassificationReasons(
  rows: Record<string, unknown>[],
  ctx: InboxBotClassificationInput
): Record<string, number> {
  const hist: Record<string, number> = {};
  for (const row of rows) {
    const ex = explainConversationBotClassification(row, ctx);
    if (!ex.isBot) {
      hist[ex.reason] = (hist[ex.reason] ?? 0) + 1;
    }
  }
  return hist;
}

/**
 * Explicación estable para logs y depuración (sin efectos secundarios).
 */
export function explainConversationBotClassification(
  conv: Record<string, unknown>,
  ctx: InboxBotClassificationInput
): BotClassificationExplanation {
  return evaluateBotConversation(conv, ctx);
}

/** Enmascara teléfono para logs (sin secretos). */
export function maskPhonePartialForLog(phone: string | null | undefined): string {
  const raw = String(phone ?? "").trim();
  if (!raw) return "";
  const d = raw.replace(/\D/g, "");
  if (d.length <= 4) return "****";
  return `${d.slice(0, 2)}…${d.slice(-2)}(${d.length})`;
}

/**
 * `true` si la conversación debe listarse solo en la pestaña **Bot** (no en Inbox).
 */
export function conversationBelongsToBotTab(
  conv: Record<string, unknown>,
  ctx: InboxBotClassificationInput
): boolean {
  return evaluateBotConversation(conv, ctx).isBot;
}

export function conversationBelongsToInboxTab(
  conv: Record<string, unknown>,
  ctx: InboxBotClassificationInput
): boolean {
  const status = String(conv.status ?? "").trim().toLowerCase();
  if (status !== "open" && status !== "pending") return false;
  return !conversationBelongsToBotTab(conv, ctx);
}
