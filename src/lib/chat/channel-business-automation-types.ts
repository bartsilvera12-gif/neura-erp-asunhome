/**
 * Automatización liviana por canal (estilo WhatsApp Business), guardada en
 * `chat_channels.config.business_automation` — independiente de `chat_flows`.
 */

export type BusinessHoursPreset = "mon_fri" | "all_days";

export interface BusinessAutomationSettings {
  /** Si false, el webhook no envía mensajes de esta capa. */
  master_enabled: boolean;
  welcome_enabled: boolean;
  /** Primera interacción = primer mensaje entrante persistido en la conversación. */
  welcome_message: string;
  hours_enabled: boolean;
  /** Zona IANA para interpretar horario (ej. America/Asuncion). */
  timezone: string;
  schedule_preset: BusinessHoursPreset;
  /** Horario local inicio/fin (24h, HH:mm). */
  day_start: string;
  day_end: string;
  away_enabled: boolean;
  away_message: string;
  /** Mínimo de minutos entre respuestas automáticas fuera de horario por conversación. */
  away_cooldown_minutes: number;
}

export const DEFAULT_BUSINESS_AUTOMATION_TIMEZONE = "America/Asuncion";

export function defaultBusinessAutomationSettings(): BusinessAutomationSettings {
  return {
    master_enabled: false,
    welcome_enabled: false,
    welcome_message:
      "¡Hola! Gracias por escribirnos. Te damos la bienvenida y en breve te atendemos.",
    hours_enabled: false,
    timezone: DEFAULT_BUSINESS_AUTOMATION_TIMEZONE,
    schedule_preset: "mon_fri",
    day_start: "08:00",
    day_end: "18:00",
    away_enabled: false,
    away_message:
      "Estamos fuera de nuestro horario de atención. Te responderemos en cuanto podamos. Gracias por tu paciencia.",
    away_cooldown_minutes: 360,
  };
}

function clipStr(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function normalizeHHmm(v: unknown, fallback: string): string {
  const s = typeof v === "string" ? v.trim() : "";
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return fallback;
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function parseBusinessAutomationFromChannelConfig(config: unknown): BusinessAutomationSettings {
  const base = defaultBusinessAutomationSettings();
  if (!config || typeof config !== "object" || Array.isArray(config)) return base;
  const root = (config as Record<string, unknown>).business_automation;
  if (!root || typeof root !== "object" || Array.isArray(root)) return base;
  const r = root as Record<string, unknown>;
  const tz = clipStr(r.timezone, 80) || base.timezone;
  const preset: BusinessHoursPreset = r.schedule_preset === "all_days" ? "all_days" : "mon_fri";
  const cdRaw = r.away_cooldown_minutes;
  const cd =
    typeof cdRaw === "number" && Number.isFinite(cdRaw)
      ? Math.min(7 * 24 * 60, Math.max(15, Math.trunc(cdRaw)))
      : base.away_cooldown_minutes;

  return {
    master_enabled: r.master_enabled === true,
    welcome_enabled: r.welcome_enabled === true,
    welcome_message: clipStr(r.welcome_message, 4000) || base.welcome_message,
    hours_enabled: r.hours_enabled === true,
    timezone: tz,
    schedule_preset: preset,
    day_start: normalizeHHmm(r.day_start, base.day_start),
    day_end: normalizeHHmm(r.day_end, base.day_end),
    away_enabled: r.away_enabled === true,
    away_message: clipStr(r.away_message, 4000) || base.away_message,
    away_cooldown_minutes: cd,
  };
}

export function businessAutomationSettingsForPersistence(
  s: BusinessAutomationSettings
): Record<string, unknown> {
  return {
    master_enabled: s.master_enabled,
    welcome_enabled: s.welcome_enabled,
    welcome_message: s.welcome_message.trim(),
    hours_enabled: s.hours_enabled,
    timezone: s.timezone.trim() || DEFAULT_BUSINESS_AUTOMATION_TIMEZONE,
    schedule_preset: s.schedule_preset,
    day_start: normalizeHHmm(s.day_start, "08:00"),
    day_end: normalizeHHmm(s.day_end, "18:00"),
    away_enabled: s.away_enabled,
    away_message: s.away_message.trim(),
    away_cooldown_minutes: s.away_cooldown_minutes,
  };
}
