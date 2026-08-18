/**
 * Extracción centralizada de referido desde texto entrante (WhatsApp).
 * Soporta ref=, REF:, referido=, # en línea corta.
 */
export function extractReferralTokenFromInboundText(raw: string): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;

  const patterns: RegExp[] = [
    /\bref\s*=\s*([A-Za-z0-9._-]{2,64})/i,
    /\bREF\s*:\s*([A-Za-z0-9._-]{2,64})/,
    /\breferido\s*=\s*([A-Za-z0-9._-]{2,64})/i,
    /\bref\s*:\s*([A-Za-z0-9._-]{2,64})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return m[1].trim();
  }

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 1 && lines[0].length <= 48) {
    const hash = lines[0].match(/^#([A-Za-z0-9._-]{2,32})$/);
    if (hash?.[1]) return hash[1].trim();
  }

  return null;
}
