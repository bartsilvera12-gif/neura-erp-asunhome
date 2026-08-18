import type { YCloudInboundIdentifiers } from "@/lib/chat/webhooks/ycloud-match";

export type YCloudWebhookEnvelope = {
  id?: string;
  type?: string;
  createTime?: string;
  whatsappInboundMessage?: Record<string, unknown>;
  /** Eco SMB o actualizaciones `whatsapp.message.updated` (estado del mensaje saliente). */
  whatsappMessage?: Record<string, unknown>;
};

export function parseYCloudWebhookEnvelope(raw: unknown): YCloudWebhookEnvelope | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as YCloudWebhookEnvelope;
}

export function extractInboundIdentifiers(msg: Record<string, unknown>): YCloudInboundIdentifiers | null {
  const wabaId = typeof msg.wabaId === "string" ? msg.wabaId : "";
  const to = typeof msg.to === "string" ? msg.to : "";
  const from = typeof msg.from === "string" ? msg.from : "";
  if (!from.trim()) return null;
  if (!to.trim() && !wabaId.trim()) return null;
  return { wabaId: wabaId.trim(), to: to.trim(), from: from.trim() };
}

/**
 * Eco `whatsapp.smb.message.echoes`: `from` = línea de negocio, `to` = cliente.
 * Para resolver canal y contacto usamos la misma heurística que inbound: `to` del
 * identificador debe ser la línea negocio y `from` el teléfono del contacto.
 */
export function extractSmbEchoIdentifiersForRouting(msg: Record<string, unknown>): YCloudInboundIdentifiers | null {
  const wabaId = typeof msg.wabaId === "string" ? msg.wabaId.trim() : "";
  const businessFrom = typeof msg.from === "string" ? msg.from.trim() : "";
  const customerTo = typeof msg.to === "string" ? msg.to.trim() : "";
  if (!customerTo) return null;
  if (!businessFrom && !wabaId) return null;
  return { wabaId, to: businessFrom, from: customerTo };
}

export function extractMessageContent(msg: Record<string, unknown>): {
  message_type: string;
  content: string | null;
} {
  const t = typeof msg.type === "string" ? msg.type : "text";
  if (t === "text") {
    const text = msg.text as Record<string, unknown> | undefined;
    const body = text && typeof text.body === "string" ? text.body : "";
    return { message_type: "text", content: body || null };
  }
  if (t === "image") {
    const im = msg.image as Record<string, unknown> | undefined;
    const cap = im && typeof im.caption === "string" ? im.caption : "";
    return { message_type: "image", content: cap || "[imagen]" };
  }
  if (t === "document") {
    const d = msg.document as Record<string, unknown> | undefined;
    const name = d && typeof d.filename === "string" ? d.filename : "documento";
    return { message_type: "document", content: `[documento] ${name}` };
  }
  if (t === "audio") return { message_type: "audio", content: "[audio]" };
  if (t === "video") return { message_type: "video", content: "[video]" };
  if (t === "sticker") return { message_type: "sticker", content: "[sticker]" };
  if (t === "location") return { message_type: "location", content: "[ubicación]" };
  if (t === "contacts") return { message_type: "contacts", content: "[contacto]" };
  if (t === "button") return { message_type: "button", content: "[botón]" };
  return { message_type: t || "unknown", content: `[${t || "mensaje"}]` };
}

export function extractExternalMessageId(msg: Record<string, unknown>): string {
  const wamid = typeof msg.wamid === "string" ? msg.wamid.trim() : "";
  if (wamid) return wamid;
  const mid = typeof msg.id === "string" ? msg.id.trim() : "";
  return mid || `ycloud-${Date.now()}`;
}

export function extractDisplayName(msg: Record<string, unknown>): string | null {
  const cp = msg.customerProfile as Record<string, unknown> | undefined;
  if (cp && typeof cp.name === "string" && cp.name.trim()) return cp.name.trim();
  return null;
}

export function extractSendTimeIso(msg: Record<string, unknown>): string | undefined {
  const st = msg.sendTime;
  return typeof st === "string" && st.trim() ? st.trim() : undefined;
}
