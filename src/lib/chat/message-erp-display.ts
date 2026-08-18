/** Helpers para mostrar adjuntos en el ERP (sin depender del cliente Supabase). */

export type RawPayload = Record<string, unknown> | null | undefined;

export function getErpAttachmentPublicUrl(raw: RawPayload): string | null {
  const erp = raw?.erp;
  if (!erp || typeof erp !== "object" || Array.isArray(erp)) return null;
  const url = (erp as { public_url?: string }).public_url;
  return typeof url === "string" && /^https?:\/\//i.test(url.trim()) ? url.trim() : null;
}

export function getErpAttachmentFilename(raw: RawPayload): string | null {
  const erp = raw?.erp;
  if (!erp || typeof erp !== "object" || Array.isArray(erp)) return null;
  const fn = (erp as { filename?: string }).filename;
  return typeof fn === "string" && fn.trim() ? fn.trim() : null;
}

export function getErpAttachmentCaption(raw: RawPayload): string | null {
  const erp = raw?.erp;
  if (!erp || typeof erp !== "object" || Array.isArray(erp)) return null;
  const c = (erp as { caption?: string }).caption;
  return typeof c === "string" && c.trim() ? c.trim() : null;
}

export function getMetaInboundDocumentFilename(raw: RawPayload): string | null {
  const doc = raw?.document;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  const fn = (doc as { filename?: string }).filename;
  return typeof fn === "string" && fn.trim() ? fn.trim() : null;
}

/**
 * URL pública de media WhatsApp/YCloud guardada en `raw_payload` (envelope o mensaje anidado).
 * No incluye cabeceras de API; algunos enlaces YCloud requieren `X-API-Key` para descarga estable.
 */
export function getWhatsAppMediaUrlFromRawPayload(raw: RawPayload): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const candidates: unknown[] = [];
  const wim = r.whatsappInboundMessage;
  const wmsg = r.whatsappMessage;
  if (wim && typeof wim === "object" && !Array.isArray(wim)) candidates.push(wim);
  if (wmsg && typeof wmsg === "object" && !Array.isArray(wmsg)) candidates.push(wmsg);
  candidates.push(r);

  for (const root of candidates) {
    if (!root || typeof root !== "object" || Array.isArray(root)) continue;
    const msg = root as Record<string, unknown>;
    for (const key of ["image", "video", "audio", "document", "sticker"] as const) {
      const media = msg[key];
      if (media && typeof media === "object" && !Array.isArray(media)) {
        const link = (media as { link?: string }).link;
        if (typeof link === "string" && /^https?:\/\//i.test(link.trim())) return link.trim();
      }
    }
  }
  return null;
}

export function isImageMimeHint(raw: RawPayload, messageType: string): boolean {
  if (messageType === "image" || messageType === "sticker") return true;
  const erp = raw?.erp;
  if (erp && typeof erp === "object" && !Array.isArray(erp)) {
    const mt = (erp as { mime_type?: string }).mime_type;
    if (typeof mt === "string" && mt.toLowerCase().startsWith("image/")) return true;
  }
  const doc = raw?.document;
  if (doc && typeof doc === "object" && !Array.isArray(doc)) {
    const mt = (doc as { mime_type?: string }).mime_type;
    if (typeof mt === "string" && mt.toLowerCase().startsWith("image/")) return true;
  }
  return false;
}
