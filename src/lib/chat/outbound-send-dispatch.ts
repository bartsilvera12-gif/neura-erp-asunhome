import type { SupabaseAdmin } from "@/lib/chat/types";
import { normalizeWaPhone } from "@/lib/chat/wa-phone";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { isLikelyUnexposedTenantChatSchema } from "@/lib/supabase/chat-data-schema";
import { sendMessageViaYCloud, ycloudSenderToE164 } from "@/lib/chat/ycloud-send-service";
import { sendWhatsAppText, type SendWhatsAppTextResult } from "@/lib/chat/whatsapp-send-service";
import type { Pool } from "pg";

/** Contexto mínimo para enviar un mensaje de texto (Meta o YCloud). */
export type ChannelOutboundTextContext =
  | { provider: "meta"; toDigits: string; phoneNumberId: string; accessToken: string }
  | { provider: "ycloud"; toDigits: string; apiKey: string; fromE164: string };

export const OUTBOUND_ERR_META_INCOMPLETE =
  "Este canal WhatsApp no tiene configuración completa. Revisá token y phone_number_id en el canal (Configuración → Canales).";

export const OUTBOUND_ERR_YCLOUD_INCOMPLETE =
  "Este canal YCloud no tiene configuración completa. Revisá ycloud_api_key y ycloud_sender_id en el canal (Configuración → Canales).";

const LOG_PREFIX = "[outbound-resolve]";

export type OutboundCredentialSource = "channel" | "legacy_env" | "mixed";

function logOutboundResolve(payload: {
  empresa_id: string;
  channel_id: string;
  provider_effective: "meta" | "ycloud";
  wa_like_channel_count: number;
  credential_source: OutboundCredentialSource;
}) {
  console.info(LOG_PREFIX, {
    empresa_id: payload.empresa_id,
    channel_id: payload.channel_id,
    provider: payload.provider_effective,
    wa_like_channel_count: payload.wa_like_channel_count,
    credential_source: payload.credential_source,
  });
}

function readYcloudConfig(config: unknown): { apiKey: string; fromE164: string | null } {
  const cfg = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
  const apiKey = typeof cfg.ycloud_api_key === "string" ? cfg.ycloud_api_key.trim() : "";
  const fromRaw = typeof cfg.ycloud_sender_id === "string" ? cfg.ycloud_sender_id.trim() : "";
  const fromE164 = fromRaw ? ycloudSenderToE164(fromRaw) : null;
  return { apiKey, fromE164 };
}

/** Canales que compiten por envío omnicanal WhatsApp (Meta / YCloud / legacy sin tipo). */
export function isOutboundWhatsappLikeChannel(r: {
  type?: string | null;
  provider?: string | null;
  activo?: boolean | null;
}): boolean {
  if (r.activo === false) return false;
  const p = String(r.provider ?? "").trim().toLowerCase();
  if (p === "ycloud" || p === "meta" || p === "whatsapp_cloud") return true;
  const t = String(r.type ?? "").trim().toLowerCase();
  if (t === "whatsapp") return true;
  if (!t && !p) return true;
  return false;
}

export function effectiveOutboundProvider(channel: {
  provider?: string | null;
  type?: string | null;
}): "meta" | "ycloud" {
  const p = String(channel.provider ?? "").trim().toLowerCase();
  if (p === "ycloud") return "ycloud";
  if (p === "whatsapp_cloud" || p === "meta" || p === "") return "meta";
  const t = String(channel.type ?? "").trim().toLowerCase();
  if (t === "whatsapp") return "meta";
  return "meta";
}

async function countOutboundWhatsappLikeChannels(
  supabase: SupabaseAdmin,
  empresaId: string,
  opts?: { dataSchema?: string }
): Promise<number> {
  const pool = getChatPostgresPool();
  const sch = opts?.dataSchema?.trim();
  if (pool && sch && isLikelyUnexposedTenantChatSchema(sch)) {
    const qt = quoteSchemaTable(sch, "chat_channels");
    const r = await pool.query(
      `SELECT id, type, provider, activo FROM ${qt} WHERE empresa_id = $1::uuid`,
      [empresaId]
    );
    const rows = (r.rows ?? []) as Array<{
      type?: string | null;
      provider?: string | null;
      activo?: boolean | null;
    }>;
    return rows.filter((row) => isOutboundWhatsappLikeChannel(row)).length;
  }

  const { data: rows, error } = await supabase
    .from("chat_channels")
    .select("id, type, provider, activo")
    .eq("empresa_id", empresaId);
  if (error) {
    console.warn(LOG_PREFIX, "count_channels_fallback_zero", { empresa_id: empresaId, err: error.message });
    return 0;
  }
  return (rows ?? []).filter((row) =>
    isOutboundWhatsappLikeChannel(row as { type?: string | null; provider?: string | null; activo?: boolean | null })
  ).length;
}

type ContactRowMin = { phone_number?: string | null };
type ChannelRowOutbound = {
  id?: string;
  empresa_id?: string;
  meta_phone_number_id?: string | null;
  whatsapp_access_token?: string | null;
  activo?: boolean;
  provider?: string | null;
  type?: string | null;
  config?: unknown;
};

function mergeCredentialSource(a: "channel" | "legacy", b: "channel" | "legacy"): OutboundCredentialSource {
  if (a === "channel" && b === "channel") return "channel";
  if (a === "legacy" && b === "legacy") return "legacy_env";
  return "mixed";
}

function resolveMetaGraphCredentials(
  channel: ChannelRowOutbound,
  waLikeChannelCount: number
): { phoneNumberId: string; accessToken: string; credential_source: OutboundCredentialSource } {
  const legacyPid = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() ?? "";
  const legacyTok = process.env.WHATSAPP_TOKEN?.trim() ?? "";
  const chPid = channel.meta_phone_number_id?.trim() ?? "";
  const chTok = typeof channel.whatsapp_access_token === "string" ? channel.whatsapp_access_token.trim() : "";

  if (waLikeChannelCount > 1) {
    if (!chPid || !chTok) {
      throw new Error(OUTBOUND_ERR_META_INCOMPLETE);
    }
    return {
      phoneNumberId: chPid,
      accessToken: chTok,
      credential_source: "channel",
    };
  }

  let phoneNumberId = chPid;
  let accessToken = chTok;
  let phoneSrc: "channel" | "legacy" = chPid ? "channel" : "legacy";
  let tokenSrc: "channel" | "legacy" = chTok ? "channel" : "legacy";

  if (!phoneNumberId) {
    if (!legacyPid) {
      throw new Error("Falta teléfono del contacto o phone_number_id del canal (y no hay WHATSAPP_PHONE_NUMBER_ID en el servidor).");
    }
    phoneNumberId = legacyPid;
    phoneSrc = "legacy";
  }

  if (!accessToken) {
    if (!legacyTok) {
      throw new Error(
        "Falta token de Meta para enviar: configurá el token en el canal o WHATSAPP_TOKEN en el servidor (solo compatibilidad legacy con un canal)."
      );
    }
    accessToken = legacyTok;
    tokenSrc = "legacy";
  }

  return {
    phoneNumberId,
    accessToken,
    credential_source: mergeCredentialSource(phoneSrc, tokenSrc),
  };
}

function buildOutboundTextContextFromRows(
  contact: ContactRowMin | null | undefined,
  channel: ChannelRowOutbound | null | undefined,
  meta: { empresaId: string; channelId: string; waLikeChannelCount: number }
): ChannelOutboundTextContext {
  if (!channel?.empresa_id) {
    throw new Error("Canal no encontrado o sin empresa_id");
  }
  if (channel.empresa_id !== meta.empresaId) {
    throw new Error("Inconsistencia empresa_id en canal");
  }

  if (channel && channel.activo === false) {
    throw new Error("El canal WhatsApp está desactivado. Activalo en Configuración.");
  }

  const toDigits = normalizeWaPhone((contact?.phone_number as string) ?? "");
  const effective = effectiveOutboundProvider(channel);

  if (effective === "ycloud") {
    if (!toDigits) {
      throw new Error("Falta teléfono del contacto para enviar por YCloud");
    }
    const { apiKey, fromE164 } = readYcloudConfig(channel?.config);
    if (meta.waLikeChannelCount > 1 && (!apiKey || !fromE164)) {
      throw new Error(OUTBOUND_ERR_YCLOUD_INCOMPLETE);
    }
    if (!apiKey) {
      throw new Error("Falta ycloud_api_key en la configuración del canal YCloud");
    }
    if (!fromE164) {
      throw new Error(
        "Falta ycloud_sender_id válido en el canal (número en formato internacional, ej. +5491123456789)"
      );
    }
    logOutboundResolve({
      empresa_id: meta.empresaId,
      channel_id: meta.channelId,
      provider_effective: "ycloud",
      wa_like_channel_count: meta.waLikeChannelCount,
      credential_source: "channel",
    });
    return { provider: "ycloud", toDigits, apiKey, fromE164 };
  }

  const { phoneNumberId, accessToken, credential_source } = resolveMetaGraphCredentials(
    channel,
    meta.waLikeChannelCount
  );

  if (!toDigits || !phoneNumberId) {
    throw new Error("Falta teléfono del contacto o phone_number_id del canal");
  }
  if (!accessToken) {
    throw new Error(
      "Falta token de Meta para enviar: configurá el token en el canal o WHATSAPP_TOKEN (solo legacy con un canal)."
    );
  }

  logOutboundResolve({
    empresa_id: meta.empresaId,
    channel_id: meta.channelId,
    provider_effective: "meta",
    wa_like_channel_count: meta.waLikeChannelCount,
    credential_source,
  });

  return { provider: "meta", toDigits, phoneNumberId, accessToken };
}

/**
 * Resuelve credenciales y destino para envío de texto según `chat_channels.provider` / tipo.
 * Prioridad: configuración del canal; fallback WHATSAPP_* solo si hay un solo canal WA-like o legacy explícito.
 */
export async function resolveOutboundTextContextFromConversationId(
  supabase: SupabaseAdmin,
  conversationId: string,
  empresaId?: string
): Promise<ChannelOutboundTextContext> {
  const cid = conversationId.trim();
  const ds = empresaId ? await fetchDataSchemaForEmpresaId(empresaId) : undefined;
  const pool = getChatPostgresPool();
  const sch = ds?.trim();

  if (pool && sch && isLikelyUnexposedTenantChatSchema(sch)) {
    const r = await pool.query(
      `SELECT contact_id::text AS contact_id, channel_id::text AS channel_id, empresa_id::text AS empresa_id
       FROM ${quoteSchemaTable(sch, "chat_conversations")}
       WHERE id = $1::uuid
       LIMIT 1`,
      [cid]
    );
    const row = r.rows?.[0] as { contact_id?: string; channel_id?: string; empresa_id?: string } | undefined;
    if (row?.contact_id && row?.channel_id && row?.empresa_id) {
      return resolveOutboundTextContextFromIds(
        supabase,
        { contactId: row.contact_id, channelId: row.channel_id },
        { dataSchema: sch, empresaId: row.empresa_id }
      );
    }
    throw new Error("Conversación no encontrada");
  }

  const { data: conv, error: convErr } = await supabase
    .from("chat_conversations")
    .select("contact_id, channel_id, empresa_id")
    .eq("id", cid)
    .maybeSingle();
  if (convErr || !conv) throw new Error(convErr?.message ?? "Conversación no encontrada");
  const eid = String((conv as { empresa_id: string }).empresa_id);
  return resolveOutboundTextContextFromIds(
    supabase,
    {
      contactId: (conv as { contact_id: string }).contact_id,
      channelId: (conv as { channel_id: string }).channel_id,
    },
    { dataSchema: ds, empresaId: eid }
  );
}

export async function resolveOutboundTextContextFromIds(
  supabase: SupabaseAdmin,
  input: { contactId: string; channelId: string },
  opts?: { dataSchema?: string; empresaId?: string }
): Promise<ChannelOutboundTextContext> {
  const pool = getChatPostgresPool();
  const sch = opts?.dataSchema?.trim();
  const usePg = Boolean(pool && sch && isLikelyUnexposedTenantChatSchema(sch));

  const channelCols =
    "id, empresa_id, meta_phone_number_id, whatsapp_access_token, activo, provider, type, config";

  if (usePg && pool && sch) {
    const qtCh = quoteSchemaTable(sch, "chat_channels");
    const [cRes, chRes] = await Promise.all([
      pool.query(
        `SELECT phone_number FROM ${quoteSchemaTable(sch, "chat_contacts")} WHERE id = $1::uuid LIMIT 1`,
        [input.contactId]
      ),
      pool.query(`SELECT ${channelCols} FROM ${qtCh} WHERE id = $1::uuid LIMIT 1`, [input.channelId]),
    ]);
    const contact = cRes.rows?.[0] as ContactRowMin | undefined;
    const channel = chRes.rows?.[0] as ChannelRowOutbound | undefined;
    if (!contact || !channel) {
      throw new Error("Contacto o canal no encontrado");
    }
    const empresaId = String(channel.empresa_id ?? opts?.empresaId ?? "");
    if (!empresaId) throw new Error("Canal sin empresa_id");
    const waLikeChannelCount = await countOutboundWhatsappLikeChannels(supabase, empresaId, { dataSchema: sch });
    return buildOutboundTextContextFromRows(contact, channel, {
      empresaId,
      channelId: input.channelId,
      waLikeChannelCount,
    });
  }

  const [{ data: contact, error: cErr }, { data: channel, error: chErr }] = await Promise.all([
    supabase.from("chat_contacts").select("phone_number").eq("id", input.contactId).maybeSingle(),
    supabase.from("chat_channels").select(channelCols).eq("id", input.channelId).maybeSingle(),
  ]);
  if (cErr) throw new Error(cErr.message);
  if (chErr) throw new Error(chErr.message);

  const ch = channel as ChannelRowOutbound | null;
  const empresaId = String(ch?.empresa_id ?? opts?.empresaId ?? "");
  if (!ch || !empresaId) {
    throw new Error("Canal no encontrado");
  }

  const waLikeChannelCount = await countOutboundWhatsappLikeChannels(supabase, empresaId, opts);
  return buildOutboundTextContextFromRows(contact as ContactRowMin | null, ch, {
    empresaId,
    channelId: input.channelId,
    waLikeChannelCount,
  });
}

export async function sendOutboundTextMessage(
  ctx: ChannelOutboundTextContext,
  text: string
): Promise<SendWhatsAppTextResult> {
  if (ctx.provider === "ycloud") {
    return sendMessageViaYCloud({
      apiKey: ctx.apiKey,
      fromE164: ctx.fromE164,
      toDigits: ctx.toDigits,
      text,
    });
  }
  return sendWhatsAppText({
    toDigits: ctx.toDigits,
    phoneNumberId: ctx.phoneNumberId,
    accessToken: ctx.accessToken,
    text,
  });
}

export function ycloudOutboundUnsupportedMessage(feature: string): string {
  return `En canales YCloud aún no está soportado: ${feature}. Usá mensaje de texto o un canal Meta.`;
}

export function ycloudOutboundUnsupported(feature: string): SendWhatsAppTextResult {
  return {
    ok: false,
    error: ycloudOutboundUnsupportedMessage(feature),
  };
}
