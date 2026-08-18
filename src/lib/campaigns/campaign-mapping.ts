import "server-only";
import {
  extractBodyPlaceholderKeysOrdered,
  extractBodyPlaceholderKeysOrderedFromText,
  getBodyComponentText,
} from "@/lib/campaigns/campaign-template-payload";

/** Normaliza claves de mapeo ("{{1}}" → "1", "{{nombre}}" → "nombre"). */
export function normalizeVariableMapping(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    const slot = k.replace(/^\{\{|\}\}$/g, "").trim();
    out[slot] = String(v ?? "").trim();
  }
  return out;
}

export function buildMappedVariablesFromRow(
  row: Record<string, string>,
  mapping: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [slot, header] of Object.entries(mapping)) {
    const key = slot.replace(/^\{\{|\}\}$/g, "").trim();
    const val = row[header];
    out[key] = val != null ? String(val).trim() : "";
  }
  return out;
}

/** Cada placeholder del body tiene una columna Excel definida en `mapping` (valor no vacío = nombre de columna). */
export function variableMappingCoversTemplate(
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

/** Placeholders del body que no tienen columna mapeada. */
export function listSlotsMissingFromMapping(
  mapping: Record<string, string>,
  templateComponentsJson: unknown[]
): string[] {
  const slots = extractBodyPlaceholderKeysOrdered(templateComponentsJson);
  return slots.filter((slot) => {
    const col = mapping[slot];
    return col == null || String(col).trim().length === 0;
  });
}

export function formatMissingMappingMessage(slot: string): string {
  return `La plantilla requiere la variable {{${slot}}}, pero no está mapeada a ninguna columna del Excel.`;
}

/** Valores vacíos para placeholders requeridos (tras aplicar fila + mapping). */
export function listSlotsWithEmptyMappedValues(
  mapped: Record<string, string>,
  templateComponentsJson: unknown[]
): string[] {
  const slots = extractBodyPlaceholderKeysOrdered(templateComponentsJson);
  return slots.filter((s) => String(mapped[s] ?? "").trim().length === 0);
}

export function formatMissingValueMessage(slot: string): string {
  return `Falta valor para la variable {{${slot}}} en esta fila del Excel.`;
}

export function mappingSatisfiedForTemplate(
  templateComponentsJson: unknown[],
  mapped: Record<string, string>
): boolean {
  const slots = extractBodyPlaceholderKeysOrdered(templateComponentsJson);
  if (slots.length === 0) return true;
  return slots.every((s) => String(mapped[s] ?? "").trim().length > 0);
}

/** Texto plano del body (para validar contra fragmentos sin snapshot completo). */
export function mappingSatisfiedForTemplateBodyText(bodyText: string, mapped: Record<string, string>): boolean {
  const slots = extractBodyPlaceholderKeysOrderedFromText(bodyText);
  if (slots.length === 0) return true;
  return slots.every((s) => String(mapped[s] ?? "").trim().length > 0);
}

/** Cobertura de mapeo usando solo texto de body (p. ej. diagnósticos). */
export function variableMappingCoversBodyText(mapping: Record<string, string>, bodyText: string): boolean {
  const slots = extractBodyPlaceholderKeysOrderedFromText(bodyText);
  if (slots.length === 0) return true;
  return slots.every((slot) => {
    const col = mapping[slot];
    return col != null && String(col).trim().length > 0;
  });
}

export function templateBodyHasPlaceholders(templateComponentsJson: unknown[]): boolean {
  return extractBodyPlaceholderKeysOrdered(templateComponentsJson).length > 0;
}

export function getTemplateBodyTextForDiagnostics(templateComponentsJson: unknown[]): string {
  return getBodyComponentText(templateComponentsJson);
}
