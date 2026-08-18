/**
 * Placeholders de plantilla WhatsApp ({{1}}, {{nombre}}, …) — sin `server-only`;
 * usable desde Client Components y desde `campaign-template-payload`.
 */

export const PLACEHOLDER_RE = /\{\{([^}]+)\}\}/g;

export function getBodyComponentText(componentsJson: unknown[]): string {
  const comps = Array.isArray(componentsJson)
    ? (componentsJson as { type?: string; text?: string }[])
    : [];
  const body = comps.find((c) => String(c.type ?? "").toUpperCase() === "BODY");
  return String(body?.text ?? "").trim();
}

export function extractBodyPlaceholderKeysOrderedFromText(bodyText: string): string[] {
  const matches = [...bodyText.matchAll(PLACEHOLDER_RE)].map((m) => m[1].trim()).filter(Boolean);
  if (matches.length === 0) return [];

  const orderedUnique: string[] = [];
  const seen = new Set<string>();
  for (const k of matches) {
    if (!seen.has(k)) {
      seen.add(k);
      orderedUnique.push(k);
    }
  }

  const allNumeric = orderedUnique.every((k) => /^\d+$/.test(k));
  if (allNumeric) {
    return [...orderedUnique].sort((a, b) => Number(a) - Number(b));
  }
  return orderedUnique;
}

export function extractTemplatePlaceholders(text: string): string[] {
  return extractBodyPlaceholderKeysOrderedFromText(text);
}

export function extractNumericSlots(text: string): string[] {
  const re = /\{\{(\d+)\}\}/g;
  const nums: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const slot = m[1];
    if (!seen.has(slot)) {
      seen.add(slot);
      nums.push(slot);
    }
  }
  return nums.sort((a, b) => Number(a) - Number(b));
}

export function extractNamedPlaceholders(text: string): string[] {
  return extractTemplatePlaceholders(text).filter((k) => !/^\d+$/.test(k));
}

export function extractBodyPlaceholderKeysOrdered(componentsJson: unknown[]): string[] {
  return extractBodyPlaceholderKeysOrderedFromText(getBodyComponentText(componentsJson));
}

export function extractBodyVariableSlotsOrdered(componentsJson: unknown[]): string[] {
  return extractNumericSlots(getBodyComponentText(componentsJson));
}

export function buildCampaignTemplatePreviewText(params: {
  templateName: string;
  languageCode: string;
  componentsSnapshot: unknown[];
  mappedBySlot: Record<string, string>;
}): string {
  const comps = Array.isArray(params.componentsSnapshot)
    ? (params.componentsSnapshot as { type?: string; text?: string }[])
    : [];
  const body = comps.find((c) => String(c.type ?? "").toUpperCase() === "BODY");
  let bodyText = String(body?.text ?? "").trim();
  if (bodyText) {
    bodyText = bodyText.replace(PLACEHOLDER_RE, (_, rawKey: string) => {
      const key = String(rawKey).trim();
      const v = params.mappedBySlot[key];
      return v !== undefined && v !== null ? String(v).trim() : `{{${key}}}`;
    });
  }
  const title = `Plantilla: ${params.templateName} · ${params.languageCode}`;
  if (bodyText) return `${title}\n\n${bodyText}`;
  return `${title}\n\n(Sin cuerpo de texto en snapshot)`;
}
