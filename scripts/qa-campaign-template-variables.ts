/**
 * QA campañas: placeholders numéricos/nombrados, orden del payload y preview.
 * Lógica alineada con `src/lib/campaigns/campaign-template-payload.ts` y `campaign-mapping.ts`.
 * Ejecutar: npm run qa:campaign-template-vars
 *
 * (Autocontenido: no importa libs con `server-only`.)
 */

const PLACEHOLDER_RE = /\{\{([^}]+)\}\}/g;

function getBodyComponentText(componentsJson: unknown[]): string {
  const comps = Array.isArray(componentsJson)
    ? (componentsJson as { type?: string; text?: string }[])
    : [];
  const body = comps.find((c) => String(c.type ?? "").toUpperCase() === "BODY");
  return String(body?.text ?? "").trim();
}

function extractBodyPlaceholderKeysOrderedFromText(bodyText: string): string[] {
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

function extractBodyPlaceholderKeysOrdered(componentsJson: unknown[]): string[] {
  return extractBodyPlaceholderKeysOrderedFromText(getBodyComponentText(componentsJson));
}

function normalizeVariableMapping(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    const slot = k.replace(/^\{\{|\}\}$/g, "").trim();
    out[slot] = String(v ?? "").trim();
  }
  return out;
}

function variableMappingCoversTemplate(
  mapping: Record<string, string>,
  templateComponentsJson: unknown[]
): boolean {
  const slots = extractBodyPlaceholderKeysOrdered(templateComponentsJson);
  if (slots.length === 0) return true;
  return slots.every((slot) => {
    const col = mapping[slot];
    return col != null && String(col).trim().length > 0;
  });
}

function listSlotsMissingFromMapping(
  mapping: Record<string, string>,
  templateComponentsJson: unknown[]
): string[] {
  const slots = extractBodyPlaceholderKeysOrdered(templateComponentsJson);
  return slots.filter((slot) => {
    const col = mapping[slot];
    return col == null || String(col).trim().length === 0;
  });
}

function mappingSatisfiedForTemplate(templateComponentsJson: unknown[], mapped: Record<string, string>): boolean {
  const slots = extractBodyPlaceholderKeysOrdered(templateComponentsJson);
  if (slots.length === 0) return true;
  return slots.every((s) => String(mapped[s] ?? "").trim().length > 0);
}

function bodyParamsFromMapped(
  componentsSnapshot: unknown[],
  mappedBySlot: Record<string, string>
): string[] {
  const slots = extractBodyPlaceholderKeysOrdered(componentsSnapshot);
  return slots.map((slot) => String(mappedBySlot[slot] ?? "").slice(0, 4096));
}

function buildCampaignTemplatePreviewText(params: {
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
  return bodyText;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const compNumeric = [{ type: "BODY", text: "Hola {{1}}, monto {{2}}." }];
const compNamed = [{ type: "BODY", text: "Hola {{nombre}}, saldo {{estado_de_cuenta}}." }];
const compNone = [{ type: "BODY", text: "Sin variables acá." }];

assert(extractBodyPlaceholderKeysOrdered(compNumeric).join(",") === "1,2", "orden {{1}}{{2}}");

const paramsNum = bodyParamsFromMapped(compNumeric, { "1": "Ana", "2": "99" });
assert(paramsNum.length === 2 && paramsNum[0] === "Ana" && paramsNum[1] === "99", "payload numérico 2 params");

const keysNamed = extractBodyPlaceholderKeysOrdered(compNamed);
assert(keysNamed.length === 2 && keysNamed[0] === "nombre" && keysNamed[1] === "estado_de_cuenta", "orden named");

const paramsNamed = bodyParamsFromMapped(compNamed, {
  nombre: "Bartolome",
  estado_de_cuenta: "150000",
});
assert(paramsNamed.length === 2 && paramsNamed[0] === "Bartolome" && paramsNamed[1] === "150000", "named 2 params");

const preview = buildCampaignTemplatePreviewText({
  componentsSnapshot: compNamed,
  mappedBySlot: { nombre: "Bartolome", estado_de_cuenta: "150000" },
});
assert(!preview.includes("{{nombre}}") && !preview.includes("{{estado_de_cuenta}}"), "preview sin placeholders");

assert(extractBodyPlaceholderKeysOrdered(compNone).length === 0, "sin variables");

const emptyMap = normalizeVariableMapping({});
assert(!variableMappingCoversTemplate(emptyMap, compNamed), "mapping vacío bloquea");
assert(listSlotsMissingFromMapping(emptyMap, compNamed).length === 2, "faltan 2 slots");
assert(mappingSatisfiedForTemplate(compNone, {}), "sin placeholders ok");

console.log("qa-campaign-template-variables: OK");
