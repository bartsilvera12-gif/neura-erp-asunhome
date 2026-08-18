/**
 * Evaluación de horario y envío de mensajes automáticos tras un inbound WhatsApp.
 * No depende de chat_flows.
 */
import {
  resolveOutboundTextContextFromConversationId,
  sendOutboundTextMessage,
} from "@/lib/chat/conversation-send-context";
import type { SupabaseAdmin } from "@/lib/chat/types";
import {
  parseBusinessAutomationFromChannelConfig,
  type BusinessAutomationSettings,
} from "@/lib/chat/channel-business-automation-types";

const NEURA_AUTOMATION = "neura_automation" as const;

type AutomationKind = "welcome" | "away_hours";

const WEEKDAY_SHORT: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Minutos desde medianoche en la zona configurada. */
export function getZonedWeekdayAndMinutes(
  date: Date,
  timeZone: string
): { weekday: number; minutes: number } | null {
  const tz = timeZone.trim() || "UTC";
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      weekday: "short",
    });
    const parts = dtf.formatToParts(date);
    let weekday = 0;
    let hour = 0;
    let minute = 0;
    for (const p of parts) {
      if (p.type === "weekday") weekday = WEEKDAY_SHORT[p.value] ?? 0;
      if (p.type === "hour") hour = parseInt(p.value, 10) || 0;
      if (p.type === "minute") minute = parseInt(p.value, 10) || 0;
    }
    return { weekday, minutes: hour * 60 + minute };
  } catch {
    return null;
  }
}

function parseHM(s: string): { h: number; m: number } {
  const [a, b] = s.split(":");
  return {
    h: Math.min(23, Math.max(0, parseInt(a, 10) || 0)),
    m: Math.min(59, Math.max(0, parseInt(b, 10) || 0)),
  };
}

/**
 * Si `hours_enabled` es false → siempre "dentro" (no dispara mensaje fuera de horario).
 * `mon_fri`: sábado y domingo se consideran fuera de horario.
 */
export function isWithinConfiguredBusinessHours(
  date: Date,
  s: Pick<BusinessAutomationSettings, "hours_enabled" | "timezone" | "schedule_preset" | "day_start" | "day_end">
): boolean {
  if (!s.hours_enabled) return true;
  const zm = getZonedWeekdayAndMinutes(date, s.timezone);
  if (!zm) return true;
  const { weekday, minutes } = zm;
  if (s.schedule_preset === "mon_fri" && (weekday === 0 || weekday === 6)) return false;
  const st = parseHM(s.day_start);
  const en = parseHM(s.day_end);
  const t0 = st.h * 60 + st.m;
  const t1 = en.h * 60 + en.m;
  if (t1 <= t0) return minutes >= t0 || minutes < t1;
  return minutes >= t0 && minutes < t1;
}

async function countMessagesInConversation(
  supabase: SupabaseAdmin,
  conversationId: string
): Promise<number> {
  const { count, error } = await supabase
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId);
  if (error) return -1;
  return count ?? 0;
}

async function hasRecentAwayAutomation(
  supabase: SupabaseAdmin,
  conversationId: string,
  cooldownMinutes: number
): Promise<boolean> {
  const since = new Date(Date.now() - cooldownMinutes * 60_000).toISOString();
  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, raw_payload, created_at")
    .eq("conversation_id", conversationId)
    .eq("from_me", true)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error || !data?.length) return false;
  return data.some((row) => {
    const rp = row.raw_payload as Record<string, unknown> | null;
    const na = rp?.[NEURA_AUTOMATION] as { kind?: string } | undefined;
    return na?.kind === "away_hours";
  });
}

async function persistOutboundAutomation(
  supabase: SupabaseAdmin,
  empresaId: string,
  conversationId: string,
  text: string,
  sendRaw: unknown,
  kind: AutomationKind,
  waMessageId: string | null
): Promise<void> {
  const now = new Date().toISOString();
  const baseRaw =
    typeof sendRaw === "object" && sendRaw !== null && !Array.isArray(sendRaw)
      ? ({ ...(sendRaw as Record<string, unknown>) } as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  baseRaw[NEURA_AUTOMATION] = { kind };
  await supabase.from("chat_messages").insert({
    empresa_id: empresaId,
    conversation_id: conversationId,
    wa_message_id: waMessageId,
    from_me: true,
    sender_type: "system",
    message_type: "text",
    content: text,
    raw_payload: baseRaw,
  });
  await supabase
    .from("chat_conversations")
    .update({
      last_message_at: now,
      last_message_preview: text.slice(0, 280),
      updated_at: now,
    })
    .eq("id", conversationId)
    .eq("empresa_id", empresaId);
}

export type BusinessAutomationInboundResult = {
  sentWelcome: boolean;
  sentAwayMessage: boolean;
};

const NO_AUTOMATION_SEND: BusinessAutomationInboundResult = {
  sentWelcome: false,
  sentAwayMessage: false,
};

/**
 * Tras persistir el mensaje entrante: bienvenida (solo primer mensaje del hilo)
 * y/o aviso fuera de horario (con cooldown).
 *
 * El webhook solo omite el motor en ese mismo inbound si hubo mensaje fuera de horario
 * (evita saturar); la bienvenida puede ejecutarse junto al primer nodo del flujo.
 */
export async function runWhatsappBusinessAutomationAfterInbound(params: {
  supabase: SupabaseAdmin;
  empresaId: string;
  channelId: string;
  conversationId: string;
  humanTakenOver: boolean;
}): Promise<BusinessAutomationInboundResult> {
  const { supabase, empresaId, channelId, conversationId, humanTakenOver } = params;
  if (humanTakenOver) return { ...NO_AUTOMATION_SEND };

  const { data: chRow, error: chErr } = await supabase
    .from("chat_channels")
    .select("config")
    .eq("id", channelId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (chErr || !chRow) return { ...NO_AUTOMATION_SEND };

  const settings = parseBusinessAutomationFromChannelConfig(
    (chRow as { config?: unknown }).config
  );
  if (!settings.master_enabled) return { ...NO_AUTOMATION_SEND };

  let ctx: Awaited<ReturnType<typeof resolveOutboundTextContextFromConversationId>>;
  try {
    ctx = await resolveOutboundTextContextFromConversationId(supabase, conversationId, empresaId);
  } catch {
    return { ...NO_AUTOMATION_SEND };
  }

  const msgCount = await countMessagesInConversation(supabase, conversationId);
  if (msgCount < 0) return { ...NO_AUTOMATION_SEND };

  const sendIfNeeded = async (text: string, kind: AutomationKind): Promise<boolean> => {
    const trimmed = text.trim();
    if (!trimmed) return false;
    const sendC = await sendOutboundTextMessage(ctx, trimmed);
    if (!sendC.ok) {
      console.warn("[business_automation] send_failed", {
        conversationId,
        kind,
        error: sendC.error,
      });
      return false;
    }
    await persistOutboundAutomation(
      supabase,
      empresaId,
      conversationId,
      trimmed,
      sendC.raw,
      kind,
      sendC.waMessageId
    );
    return true;
  };

  let sentWelcome = false;
  let sentAwayMessage = false;

  if (settings.welcome_enabled && msgCount === 1) {
    sentWelcome = await sendIfNeeded(settings.welcome_message, "welcome");
  }

  if (
    settings.hours_enabled &&
    settings.away_enabled &&
    !isWithinConfiguredBusinessHours(new Date(), settings)
  ) {
    const recent = await hasRecentAwayAutomation(
      supabase,
      conversationId,
      settings.away_cooldown_minutes
    );
    if (!recent) {
      sentAwayMessage = await sendIfNeeded(settings.away_message, "away_hours");
    }
  }

  return { sentWelcome, sentAwayMessage };
}
