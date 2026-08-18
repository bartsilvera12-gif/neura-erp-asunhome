/**
 * Estado visual de secciones del formulario de canal (expandir + switch “activo”).
 * Persistido en `chat_channels.config.form_section_state`.
 */

export const CHANNEL_FORM_SECTION_KEYS = [
  "credentials",
  "business_automation",
  "bot_wake_keywords",
  "comprobantes_core",
  "comprobantes_bank",
  "comprobantes_messages",
  "quick_replies",
] as const;

export type ChannelFormSectionKey = (typeof CHANNEL_FORM_SECTION_KEYS)[number];

export type ChannelFormSectionSlice = {
  active: boolean;
  expanded: boolean;
};

export type ChannelFormSectionStateMap = Record<ChannelFormSectionKey, ChannelFormSectionSlice>;

export function defaultChannelFormSectionState(): ChannelFormSectionStateMap {
  return {
    credentials: { active: true, expanded: true },
    business_automation: { active: true, expanded: false },
    bot_wake_keywords: { active: true, expanded: false },
    comprobantes_core: { active: true, expanded: false },
    comprobantes_bank: { active: true, expanded: false },
    comprobantes_messages: { active: true, expanded: false },
    quick_replies: { active: true, expanded: false },
  };
}

function hasPersistedFormSectionState(config: unknown): boolean {
  if (!config || typeof config !== "object" || Array.isArray(config)) return false;
  const raw = (config as Record<string, unknown>).form_section_state;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  return Object.keys(raw as Record<string, unknown>).length > 0;
}

export function parseFormSectionStateFromChannelConfig(config: unknown): ChannelFormSectionStateMap {
  const out = defaultChannelFormSectionState();
  const cfgRoot =
    config && typeof config === "object" && !Array.isArray(config)
      ? (config as Record<string, unknown>)
      : {};
  /** Compat: antes solo existía `quick_replies_inbox_enabled` en config. */
  const qrLegacyEnabled = cfgRoot.quick_replies_inbox_enabled !== false;

  const rawFs = cfgRoot.form_section_state;
  if (!rawFs || typeof rawFs !== "object" || Array.isArray(rawFs)) {
    out.quick_replies = { active: qrLegacyEnabled, expanded: false };
    return out;
  }

  const r = rawFs as Record<string, unknown>;
  for (const key of CHANNEL_FORM_SECTION_KEYS) {
    const slice = r[key];
    if (!slice || typeof slice !== "object" || Array.isArray(slice)) continue;
    const o = slice as Record<string, unknown>;
    const b = out[key];
    out[key] = {
      active: typeof o.active === "boolean" ? o.active : b.active,
      expanded: typeof o.expanded === "boolean" ? o.expanded : b.expanded,
    };
  }

  const qrSlice = r.quick_replies;
  if (!qrSlice || typeof qrSlice !== "object" || Array.isArray(qrSlice)) {
    out.quick_replies = { active: qrLegacyEnabled, expanded: false };
  }

  /** Inactivo ⇒ nunca persistir “expandido” (evita panel 1fr + hueco tras recargar). */
  if (!out.quick_replies.active) {
    out.quick_replies = { ...out.quick_replies, expanded: false };
  }

  return out;
}

/**
 * Alinea switches de comprobantes con `enabled` real cuando aún no hay `form_section_state` persistido
 * (evita “Activo” en verde si la validación de comprobantes está apagada).
 */
export function parseFormSectionStateFromChannelConfigWithCvSync(
  config: unknown,
  comprobanteValidationEnabled: boolean
): ChannelFormSectionStateMap {
  const out = parseFormSectionStateFromChannelConfig(config);
  if (!hasPersistedFormSectionState(config)) {
    out.comprobantes_core.active = comprobanteValidationEnabled;
    out.comprobantes_bank.active = comprobanteValidationEnabled;
    out.comprobantes_messages.active = comprobanteValidationEnabled;
  }
  return out;
}

export function formSectionStateForPersistence(
  state: ChannelFormSectionStateMap
): Record<string, { active: boolean; expanded: boolean }> {
  const o: Record<string, { active: boolean; expanded: boolean }> = {};
  for (const key of CHANNEL_FORM_SECTION_KEYS) {
    o[key] = { active: state[key].active, expanded: state[key].expanded };
  }
  return o;
}
