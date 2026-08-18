import { normalizeWaPhone } from "@/lib/chat/wa-phone";
import type { SendWhatsAppTextResult } from "@/lib/chat/whatsapp-send-service";

/** Endpoint enqueue según OpenAPI oficial YCloud (`POST /v2/whatsapp/messages`). */
const YCLOUD_WHATSAPP_MESSAGES_URL = "https://api.ycloud.com/v2/whatsapp/messages";

function digitsToE164(digits: string): string | null {
  const d = normalizeWaPhone(digits);
  if (!d) return null;
  return `+${d}`;
}

async function postYCloudWhatsappMessage(
  apiKey: string,
  body: Record<string, unknown>
): Promise<SendWhatsAppTextResult> {
  const res = await fetch(YCLOUD_WHATSAPP_MESSAGES_URL, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const errObj = raw.error as Record<string, unknown> | undefined;
    const msg =
      (typeof errObj?.message === "string" && errObj.message) ||
      (typeof raw.message === "string" && raw.message) ||
      res.statusText;
    console.warn("[ycloud-send] request_failed", { status: res.status, raw });
    return {
      ok: false,
      error: msg || `HTTP ${res.status}`,
      status: res.status,
      raw,
    };
  }

  const ycloudStatus = typeof raw.status === "string" ? raw.status.toLowerCase() : "";
  if (ycloudStatus === "failed") {
    const errMsg =
      (typeof raw.errorMessage === "string" && raw.errorMessage.trim()) ||
      "El proveedor marcó el mensaje como fallido";
    const errCode = raw.errorCode ?? (raw as { errroCode?: unknown }).errroCode;
    const codeStr = errCode != null ? String(errCode) : "";
    console.warn("[ycloud-send] provider_failed", { httpStatus: res.status, ycloudStatus, code: codeStr });
    return {
      ok: false,
      error: errMsg,
      code: codeStr || undefined,
      status: res.status,
      raw,
    };
  }

  const wamid = typeof raw.wamid === "string" ? raw.wamid : null;
  const id = typeof raw.id === "string" ? raw.id : null;
  const waMessageId = wamid || id;
  console.info("[ycloud-send] accepted", { waMessageId, status: res.status });
  return { ok: true, waMessageId, raw };
}

/**
 * Envía texto por WhatsApp usando la API REST de YCloud (no Meta Graph).
 * Autenticación: header `X-API-Key` (esquema documentado en OpenAPI).
 */
export async function sendMessageViaYCloud(params: {
  apiKey: string;
  /** Número de negocio en E.164 (p. ej. +54911…), desde config.ycloud_sender_id */
  fromE164: string;
  /** Solo dígitos del cliente (mismo formato que usa Meta en el ERP) */
  toDigits: string;
  text: string;
}): Promise<SendWhatsAppTextResult> {
  const toE164 = digitsToE164(params.toDigits);
  if (!toE164) {
    return { ok: false, error: "Teléfono de destino inválido para YCloud" };
  }

  return postYCloudWhatsappMessage(params.apiKey, {
    from: params.fromE164,
    to: toE164,
    type: "text",
    text: { body: params.text },
  });
}

export type YCloudOutboundMediaKind = "image" | "document" | "audio" | "video";

/**
 * Envía imagen / documento / audio / video con URL https pública (p. ej. Supabase Storage),
 * mismo patrón que la WhatsApp Cloud API.
 */
export async function sendYCloudWhatsappMediaViaLink(params: {
  apiKey: string;
  fromE164: string;
  toDigits: string;
  kind: YCloudOutboundMediaKind;
  mediaLink: string;
  caption?: string;
  filename?: string;
}): Promise<SendWhatsAppTextResult> {
  const toE164 = digitsToE164(params.toDigits);
  if (!toE164) {
    return { ok: false, error: "Teléfono de destino inválido para YCloud" };
  }
  const link = params.mediaLink.trim();
  if (!/^https:\/\//i.test(link)) {
    return { ok: false, error: "El archivo debe estar en una URL https pública" };
  }

  const kind = params.kind;
  const cap = params.caption?.trim();

  let mediaPayload: Record<string, unknown> = { link };
  if (kind === "image") {
    if (cap) mediaPayload = { link, caption: cap };
  } else if (kind === "document") {
    mediaPayload = {
      link,
      filename: (params.filename?.trim() || "archivo").slice(0, 240),
    };
    if (cap) mediaPayload.caption = cap;
  } else if (kind === "video") {
    if (cap) mediaPayload = { link, caption: cap };
  }
  /* audio: solo link (WhatsApp Cloud API) */

  return postYCloudWhatsappMessage(params.apiKey, {
    from: params.fromE164,
    to: toE164,
    type: kind,
    [kind]: mediaPayload,
  });
}

export function ycloudSenderToE164(senderId: string): string | null {
  return digitsToE164(senderId);
}

/**
 * Envío de plantilla WhatsApp vía API YCloud (mismo host que texto).
 * `externalId` recomendado para reconciliar webhooks (p. ej. campaign:uuid:recipient:uuid).
 */
export async function sendYCloudWhatsappTemplateMessage(params: {
  apiKey: string;
  fromE164: string;
  toDigits: string;
  templatePayload: Record<string, unknown>;
  externalId?: string;
}): Promise<SendWhatsAppTextResult> {
  const toE164 = digitsToE164(params.toDigits);
  if (!toE164) {
    return { ok: false, error: "Teléfono de destino inválido para YCloud" };
  }

  const body: Record<string, unknown> = {
    from: params.fromE164,
    to: toE164,
    type: "template",
    template: params.templatePayload,
  };
  if (params.externalId?.trim()) {
    body.externalId = params.externalId.trim().slice(0, 512);
  }

  return postYCloudWhatsappMessage(params.apiKey, body);
}
