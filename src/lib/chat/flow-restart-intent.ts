import type { SupabaseAdmin } from "@/lib/chat/types";
import {
  listActiveWhatsappFlowsForEmpresa,
  matchesConversationRestartKeyword,
  restartWhatsappConversationToFlowStart,
} from "@/lib/chat/resolve-whatsapp-active-flow";

const LOG = "[purchase-intent-restart]" as const;

export type FlowRestartIntentConfig = {
  restart_enabled: boolean;
  restart_node_code: string | null;
  restart_keywords: string[];
  restart_strong_keywords: string[];
  restart_when_completed: boolean;
  restart_when_abandoned: boolean;
  do_not_restart_when_human_taken_over: boolean;
};

const DEFAULT_SOFT_KEYWORDS = [
  "boletos",
  "boleto",
  "quiero comprar",
  "comprar",
  "participar",
  "quiero participar",
  "más números",
  "mas numeros",
  "quiero números",
  "quiero numeros",
  "otra vez",
  "comprar otra vez",
] as const;

/** Por defecto también fuerzan reinicio en pasos sensibles (cédula/comprobante). */
function defaultStrongKeywords(): string[] {
  return [
    "volver a empezar",
    "boletos",
    "boleto",
    "menu",
    "menú",
    "hola",
    "comenzar",
    "iniciar",
    "reiniciar",
    "inicio",
  ];
}

function asTrimmedStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean);
}

function normalizePhrase(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Coincidencia por frase completa o subcadena (frases más largas primero).
 * Devuelve la entrada de configuración que matcheó (para auditoría).
 */
export function matchRestartPhraseList(text: string, phrases: string[]): string | null {
  const n = normalizePhrase(text);
  if (!n) return null;
  const sorted = [...phrases].sort((a, b) => b.length - a.length);
  for (const p of sorted) {
    const pn = normalizePhrase(p);
    if (!pn) continue;
    if (n === pn) return p;
    if (n.includes(pn)) return p;
  }
  return null;
}

function mergeKeywordLists(base: string[], extra: string[]): string[] {
  const set = new Set<string>();
  for (const x of [...base, ...extra]) {
    const t = x.trim();
    if (t) set.add(t);
  }
  return [...set];
}

export function parseFlowRestartIntentConfig(
  flowConfig: Record<string, unknown> | null | undefined
): FlowRestartIntentConfig {
  const fc = flowConfig && typeof flowConfig === "object" ? flowConfig : {};
  const restart_enabled = fc.restart_enabled === true;

  const restart_node_code =
    typeof fc.restart_node_code === "string" && fc.restart_node_code.trim()
      ? fc.restart_node_code.trim()
      : null;

  const customSoft = asTrimmedStringArray(fc.restart_keywords);
  const restart_keywords =
    customSoft.length > 0 ? mergeKeywordLists([...DEFAULT_SOFT_KEYWORDS], customSoft) : [...DEFAULT_SOFT_KEYWORDS];

  const customStrong = asTrimmedStringArray(fc.restart_strong_keywords);
  const restart_strong_keywords =
    customStrong.length > 0
      ? mergeKeywordLists(defaultStrongKeywords(), customStrong)
      : defaultStrongKeywords();

  return {
    restart_enabled,
    restart_node_code,
    restart_keywords,
    restart_strong_keywords,
    restart_when_completed: fc.restart_when_completed !== false,
    restart_when_abandoned: fc.restart_when_abandoned !== false,
    do_not_restart_when_human_taken_over: fc.do_not_restart_when_human_taken_over !== false,
  };
}

async function fetchFlowConfigJson(
  supabase: SupabaseAdmin,
  empresaId: string,
  flowCode: string
): Promise<Record<string, unknown> | null> {
  const fc = flowCode.trim();
  if (!fc) return null;
  const { data, error } = await supabase
    .from("chat_flows")
    .select("flow_config")
    .eq("empresa_id", empresaId)
    .eq("flow_code", fc)
    .maybeSingle();
  if (error) {
    console.warn(LOG, "flow_config_load_failed", { empresaId, flowCode: fc, message: error.message });
    return null;
  }
  const raw = (data as { flow_config?: unknown } | null)?.flow_config;
  return raw && typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null;
}

async function isNodeCaptureSensitive(
  supabase: SupabaseAdmin,
  empresaId: string,
  flowCode: string,
  nodeCode: string | null | undefined
): Promise<boolean> {
  const nc = nodeCode?.trim();
  const fc = flowCode.trim();
  if (!fc || !nc) return false;
  const { data, error } = await supabase
    .from("chat_flow_nodes")
    .select("node_type, save_as_field")
    .eq("empresa_id", empresaId)
    .eq("flow_code", fc)
    .eq("node_code", nc)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) return false;
  const row = data as { node_type?: string; save_as_field?: string | null };
  if (row.node_type === "image_input") return true;
  if (row.node_type === "text" && String(row.save_as_field ?? "").trim()) return true;
  return false;
}

export type MaybeRestartForPurchaseIntentArgs = {
  messageType: string;
  content: string;
  convFlow: string | null;
  convNode: string | null;
  convHuman: boolean;
  convFlowStatus: string | null;
  restartedThisMessage: boolean;
  /** Config del canal (`chat_channels.config`) para keywords de despertar; si falta, defaults del sistema. */
  channelConfig?: Record<string, unknown> | null;
};

export type MaybeRestartForPurchaseIntentResult = {
  restarted: boolean;
  flow_code: string | null;
  flow_current_node: string | null;
  new_flow_session_id: string | null;
  reason: string;
};

/**
 * Reinicio seguro por intención de compra / frases tipo “boletos”, “quiero comprar”.
 * Requiere `chat_flows.flow_config.restart_enabled` y resto de opciones por flujo.
 */
export async function maybeRestartForPurchaseIntent(
  supabase: SupabaseAdmin,
  empresaId: string,
  conversationId: string,
  args: MaybeRestartForPurchaseIntentArgs
): Promise<MaybeRestartForPurchaseIntentResult> {
  const noop = (reason: string): MaybeRestartForPurchaseIntentResult => ({
    restarted: false,
    flow_code: null,
    flow_current_node: null,
    new_flow_session_id: null,
    reason,
  });

  if (args.restartedThisMessage) return noop("already_restarted_this_message");
  if (args.messageType !== "text") return noop("not_text");
  const content = args.content?.trim() ?? "";
  if (!content) return noop("empty_content");

  if (matchesConversationRestartKeyword(content, args.channelConfig ?? undefined)) {
    return noop("handled_by_restart_keyword_branch");
  }

  const catalog = await listActiveWhatsappFlowsForEmpresa(supabase, empresaId);
  if (catalog.kind === "none") return noop("no_active_flow");

  const cf = args.convFlow?.trim() || null;
  const effectiveFlow =
    cf && catalog.allActiveCodes.includes(cf) ? cf : catalog.flowCode;

  const flowConfigJson = await fetchFlowConfigJson(supabase, empresaId, effectiveFlow);
  const cfg = parseFlowRestartIntentConfig(flowConfigJson);
  if (!cfg.restart_enabled) return noop("restart_not_enabled");

  if (cfg.do_not_restart_when_human_taken_over && (args.convHuman || args.convFlowStatus === "human")) {
    console.info(LOG, "skip_human_mode", { conversationId });
    return noop("human_taken_over");
  }

  const strongMatch = matchRestartPhraseList(content, cfg.restart_strong_keywords);
  const softMatch = matchRestartPhraseList(content, cfg.restart_keywords);
  const matched = strongMatch ?? softMatch;
  if (!matched) return noop("no_keyword_match");

  const isStrong = Boolean(strongMatch);

  const { data: activeRow } = await supabase
    .from("chat_flow_sessions")
    .select("id, status")
    .eq("empresa_id", empresaId)
    .eq("conversation_id", conversationId)
    .eq("flow_code", effectiveFlow)
    .eq("status", "active")
    .maybeSingle();

  const { data: latestRows } = await supabase
    .from("chat_flow_sessions")
    .select("id, status")
    .eq("empresa_id", empresaId)
    .eq("conversation_id", conversationId)
    .eq("flow_code", effectiveFlow)
    .order("created_at", { ascending: false })
    .limit(1);

  const latest = latestRows?.[0] as { id?: string; status?: string } | undefined;

  if (!isStrong && latest?.status === "completed" && !cfg.restart_when_completed) {
    console.info(LOG, "skip_completed_session_soft", { conversationId });
    return noop("completed_no_restart_soft");
  }
  if (!isStrong && latest?.status === "abandoned" && !cfg.restart_when_abandoned) {
    console.info(LOG, "skip_abandoned_session_soft", { conversationId });
    return noop("abandoned_no_restart_soft");
  }

  if (!isStrong && activeRow && (await isNodeCaptureSensitive(supabase, empresaId, effectiveFlow, args.convNode))) {
    console.info(LOG, "skip_sensitive_step_soft", {
      conversationId,
      flow_code: effectiveFlow,
      node_code: args.convNode,
    });
    return noop("sensitive_capture_soft_blocked");
  }

  const rr = await restartWhatsappConversationToFlowStart(supabase, empresaId, conversationId, {
    preferFlowCode: effectiveFlow,
    trigger: `purchase_intent:${matched}`,
    targetNodeCode: cfg.restart_node_code,
    preserveReferralFromPreviousSession: true,
    intentAudit: { matched_keyword: matched },
  });

  if (!rr.restarted) {
    console.warn(LOG, "restart_failed", { conversationId, reason: rr.reason });
    return { restarted: false, flow_code: null, flow_current_node: null, new_flow_session_id: null, reason: rr.reason };
  }

  console.info(LOG, "restart_ok", {
    conversationId,
    flow_code: rr.flow_code,
    node: rr.flow_current_node,
    matched,
    isStrong,
  });

  return {
    restarted: true,
    flow_code: rr.flow_code,
    flow_current_node: rr.flow_current_node,
    new_flow_session_id: rr.new_flow_session_id ?? null,
    reason: rr.reason,
  };
}
