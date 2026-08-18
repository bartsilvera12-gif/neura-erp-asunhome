/**
 * Algunos webhooks YCloud entregan `audio`/`image` sin `link` público; la API de recuperación de mensaje
 * puede exponer el enlace temporal para reproducir en el ERP.
 */
import { getErpAttachmentPublicUrl, getWhatsAppMediaUrlFromRawPayload } from "@/lib/chat/message-erp-display";

const YCLOUD_MESSAGE_RETRIEVE_URL = "https://api.ycloud.com/v2/whatsapp/messages";

export async function fetchYCloudWhatsappMessageJson(
  apiKey: string,
  waMessageId: string
): Promise<Record<string, unknown> | null> {
  const id = waMessageId.trim();
  const key = apiKey.trim();
  if (!id || !key) return null;
  try {
    const res = await fetch(`${YCLOUD_MESSAGE_RETRIEVE_URL}/${encodeURIComponent(id)}`, {
      method: "GET",
      headers: { "X-API-Key": key, Accept: "application/json" },
    });
    if (!res.ok) {
      console.info("[ycloud-inbound-media-enrich] retrieve_non_ok", { status: res.status });
      return null;
    }
    const json = (await res.json().catch(() => null)) as unknown;
    if (!json || typeof json !== "object" || Array.isArray(json)) return null;
    return json as Record<string, unknown>;
  } catch (e) {
    console.warn("[ycloud-inbound-media-enrich] retrieve_error", e);
    return null;
  }
}

function collectHttpsLinks(obj: unknown, acc: string[], depth = 0): void {
  if (depth > 12 || obj == null) return;
  if (typeof obj === "string") {
    if (/^https:\/\//i.test(obj.trim())) acc.push(obj.trim());
    return;
  }
  if (typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (const x of obj) collectHttpsLinks(x, acc, depth + 1);
    return;
  }
  const o = obj as Record<string, unknown>;
  for (const [k, v] of Object.entries(o)) {
    if (k === "link" && typeof v === "string" && /^https:\/\//i.test(v.trim())) {
      acc.push(v.trim());
    } else {
      collectHttpsLinks(v, acc, depth + 1);
    }
  }
}

/** Primera URL https encontrada en el documento (típicamente `*.link` en image/audio/…). */
export function firstHttpsMediaLinkFromYCloudMessageDoc(doc: Record<string, unknown> | null): string | null {
  if (!doc) return null;
  const acc: string[] = [];
  collectHttpsLinks(doc, acc);
  return acc[0] ?? null;
}

export async function enrichYCloudStoredRawPayloadWithResolvableMediaUrl(input: {
  apiKey: string;
  waMessageId: string;
  storedRaw: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  if (getErpAttachmentPublicUrl(input.storedRaw) || getWhatsAppMediaUrlFromRawPayload(input.storedRaw)) {
    return input.storedRaw;
  }
  const doc = await fetchYCloudWhatsappMessageJson(input.apiKey, input.waMessageId);
  const link = firstHttpsMediaLinkFromYCloudMessageDoc(doc);
  if (!link) return input.storedRaw;

  const erpExisting =
    input.storedRaw.erp && typeof input.storedRaw.erp === "object" && !Array.isArray(input.storedRaw.erp)
      ? (input.storedRaw.erp as Record<string, unknown>)
      : {};

  return {
    ...input.storedRaw,
    erp: {
      ...erpExisting,
      public_url: link,
      ycloud_message_retrieve: true,
    },
  };
}
