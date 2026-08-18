/**
 * Palabras opcionales por canal (`chat_channels.config`) para reiniciar/despertar el bot.
 * Si no hay configuración activa o lista vacía, se usa el mismo conjunto y reglas que antes del feature.
 */

export const BOT_WAKE_KEYWORDS_MAX_COUNT = 30;
export const BOT_WAKE_KEYWORDS_MAX_LENGTH = 60;

/** Set histórico usado por `matchesConversationRestartKeyword` antes de la config por canal. */
export const DEFAULT_BOT_WAKE_KEYWORDS = new Set([
  "hola",
  "menu",
  "menú",
  "comenzar",
  "iniciar",
  "reiniciar",
  "inicio",
]);

export type BotWakeKeywordsMatchMode = "exact" | "starts_with";

export type BotWakeKeywordsFormState = {
  enabled: boolean;
  keywords: string[];
  matchMode: BotWakeKeywordsMatchMode;
};

export type BotWakeKeywordMatchMeta = {
  matched: boolean;
  source: "channel_config" | "default";
  /** Frase normalizada que disparó el match (canal o default). */
  matchedNormalized?: string;
};

function partialId(id: string | undefined): string | null {
  if (!id || typeof id !== "string") return null;
  const t = id.trim();
  if (t.length < 8) return `${t.slice(0, 4)}…`;
  return `${t.slice(0, 8)}…`;
}

export function normalizeWakeKeywordText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

/** Lógica legacy (primer token o mensaje de una sola palabra). */
export function matchesDefaultConversationRestartKeyword(text: string): boolean {
  const raw = normalizeWakeKeywordText(text);
  if (!raw) return false;
  const keywords = DEFAULT_BOT_WAKE_KEYWORDS;
  const tokens = raw.split(/\s+/).filter(Boolean);
  const first = tokens[0] ?? "";
  if (keywords.has(first)) return true;
  if (tokens.length === 1 && keywords.has(raw)) return true;
  return false;
}

export function parseBotWakeKeywordsMatchMode(v: unknown): BotWakeKeywordsMatchMode {
  return v === "starts_with" ? "starts_with" : "exact";
}

/**
 * Lee flags desde `chat_channels.config`.
 * `useCustom` solo si enabled=true y hay al menos una keyword no vacía tras normalizar entrada.
 */
export function getBotWakeKeywordsForChannel(config: Record<string, unknown> | null | undefined): {
  useCustom: boolean;
  keywordsNormalized: string[];
  matchMode: BotWakeKeywordsMatchMode;
} {
  const enabled = config?.bot_wake_keywords_enabled === true;
  const raw = config?.bot_wake_keywords;
  const arr = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const keywordsNormalized: string[] = [];
  for (const item of arr) {
    if (typeof item !== "string") continue;
    const n = normalizeWakeKeywordText(item);
    if (!n || n.length > BOT_WAKE_KEYWORDS_MAX_LENGTH) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    keywordsNormalized.push(n);
    if (keywordsNormalized.length >= BOT_WAKE_KEYWORDS_MAX_COUNT) break;
  }
  const matchMode = parseBotWakeKeywordsMatchMode(config?.bot_wake_keywords_match_mode);
  const useCustom = enabled && keywordsNormalized.length > 0;
  return { useCustom, keywordsNormalized, matchMode };
}

export function parseBotWakeKeywordsSettingsFromConfig(config: unknown): BotWakeKeywordsFormState {
  const c =
    config && typeof config === "object" && !Array.isArray(config) ? (config as Record<string, unknown>) : {};
  const raw = c.bot_wake_keywords;
  const keywords = Array.isArray(raw)
    ? raw.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean)
    : [];
  return {
    enabled: c.bot_wake_keywords_enabled === true,
    keywords,
    matchMode: parseBotWakeKeywordsMatchMode(c.bot_wake_keywords_match_mode),
  };
}

export function sanitizeBotWakeKeywordsForPersistence(
  state: BotWakeKeywordsFormState
): {
  bot_wake_keywords_enabled: boolean;
  bot_wake_keywords: string[];
  bot_wake_keywords_match_mode: BotWakeKeywordsMatchMode;
} {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of state.keywords) {
    if (typeof k !== "string") continue;
    const t = k.trim();
    if (!t) continue;
    if (t.length > BOT_WAKE_KEYWORDS_MAX_LENGTH) continue;
    const n = normalizeWakeKeywordText(t);
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(t);
    if (out.length >= BOT_WAKE_KEYWORDS_MAX_COUNT) break;
  }
  return {
    bot_wake_keywords_enabled: Boolean(state.enabled),
    bot_wake_keywords: out,
    bot_wake_keywords_match_mode: state.matchMode === "starts_with" ? "starts_with" : "exact",
  };
}

/** Merge en `config` del canal al guardar el formulario (omitir si ningún campo viene definido). */
export function applyBotWakeKeywordsInputToChannelConfig(
  config: Record<string, unknown>,
  input: Partial<{
    bot_wake_keywords_enabled: boolean;
    bot_wake_keywords: string[];
    bot_wake_keywords_match_mode: BotWakeKeywordsMatchMode;
  }>
): void {
  if (
    input.bot_wake_keywords_enabled === undefined &&
    input.bot_wake_keywords === undefined &&
    input.bot_wake_keywords_match_mode === undefined
  ) {
    return;
  }
  const sanitized = sanitizeBotWakeKeywordsForPersistence({
    enabled: input.bot_wake_keywords_enabled ?? false,
    keywords: Array.isArray(input.bot_wake_keywords) ? input.bot_wake_keywords : [],
    matchMode:
      input.bot_wake_keywords_match_mode === "starts_with" ? "starts_with" : "exact",
  });
  config.bot_wake_keywords_enabled = sanitized.bot_wake_keywords_enabled;
  config.bot_wake_keywords = sanitized.bot_wake_keywords;
  config.bot_wake_keywords_match_mode = sanitized.bot_wake_keywords_match_mode;
}

function sortPhrasesForMatching(phrases: string[]): string[] {
  const multi = phrases.filter((p) => p.includes(" "));
  const single = phrases.filter((p) => !p.includes(" "));
  multi.sort((a, b) => b.length - a.length);
  return [...multi, ...single];
}

function matchCustomWakeKeywords(
  rawNormalized: string,
  phrases: string[],
  matchMode: BotWakeKeywordsMatchMode
): string | null {
  if (!rawNormalized) return null;
  const tokens = rawNormalized.split(/\s+/).filter(Boolean);
  const first = tokens[0] ?? "";

  for (const phrase of sortPhrasesForMatching(phrases)) {
    if (phrase.includes(" ")) {
      if (matchMode === "starts_with") {
        if (rawNormalized === phrase || rawNormalized.startsWith(`${phrase} `)) return phrase;
      } else {
        if (rawNormalized === phrase) return phrase;
      }
    } else {
      if (first === phrase) return phrase;
      if (tokens.length === 1 && rawNormalized === phrase) return phrase;
    }
  }
  return null;
}

export function isBotWakeKeyword(
  messageText: string,
  channelConfig: Record<string, unknown> | null | undefined,
  logCtx?: { channelId?: string; empresaId?: string }
): BotWakeKeywordMatchMeta {
  const { useCustom, keywordsNormalized, matchMode } = getBotWakeKeywordsForChannel(channelConfig ?? undefined);
  const raw = normalizeWakeKeywordText(messageText);

  if (!useCustom) {
    const matched = matchesDefaultConversationRestartKeyword(messageText);
    if (matched) {
      const tokens = raw.split(/\s+/).filter(Boolean);
      const hit = tokens[0] && DEFAULT_BOT_WAKE_KEYWORDS.has(tokens[0]) ? tokens[0] : raw;
      console.info("[bot_wake_keywords]", "match", {
        channel_id: partialId(logCtx?.channelId),
        empresa_id: partialId(logCtx?.empresaId),
        matched: true,
        source: "default",
        keyword: hit,
      });
    }
    return { matched, source: "default", matchedNormalized: matched ? raw.split(/\s+/)[0] ?? raw : undefined };
  }

  const hit = matchCustomWakeKeywords(raw, keywordsNormalized, matchMode);
  const matched = Boolean(hit);
  if (matched) {
    console.info("[bot_wake_keywords]", "match", {
      channel_id: partialId(logCtx?.channelId),
      empresa_id: partialId(logCtx?.empresaId),
      matched: true,
      source: "channel_config",
      keyword: hit ?? null,
      match_mode: matchMode,
    });
  }
  return { matched, source: "channel_config", matchedNormalized: hit ?? undefined };
}

/** Compat: config opcional del canal y logging opcional (ids parciales). */
export function matchesConversationRestartKeyword(
  text: string,
  channelConfig?: Record<string, unknown> | null,
  logCtx?: { channelId?: string; empresaId?: string }
): boolean {
  return isBotWakeKeyword(text, channelConfig ?? undefined, logCtx).matched;
}
