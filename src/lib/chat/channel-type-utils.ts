/**
 * Normaliza tipo de canal omnicanal (filas legacy o valores null en BD).
 */
export function normalizeChannelType(v: unknown): string {
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    return t.length > 0 ? t : "whatsapp";
  }
  if (v != null) {
    const s = String(v).trim().toLowerCase();
    if (s.length > 0) return s;
  }
  return "whatsapp";
}
