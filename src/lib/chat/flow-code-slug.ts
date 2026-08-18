/** Longitud máxima razonable para `chat_flows.flow_code` (Postgres text). */
const MAX_FLOW_CODE_LEN = 96;

/**
 * Genera un `flow_code` a partir del nombre visible:
 * minúsculas, sin tildes, espacios y caracteres especiales → `_`.
 */
export function slugifyFlowCodeFromLabel(name: string): string {
  let s = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!s) s = "flujo";
  if (/^[0-9]/.test(s)) s = `flujo_${s}`;
  return s.slice(0, MAX_FLOW_CODE_LEN);
}

/** Normaliza un código escrito a mano en opciones avanzadas. */
export function normalizeManualFlowCode(raw: string): string {
  return slugifyFlowCodeFromLabel(raw.replace(/_/g, " "));
}

/**
 * Si `base` ya existe, prueba `base_2`, `base_3`, … sin romper flows existentes.
 */
export function pickUniqueFlowCode(base: string, existing: ReadonlySet<string>): string {
  const b = base.slice(0, MAX_FLOW_CODE_LEN);
  if (!existing.has(b)) return b;
  let n = 2;
  while (n < 10_000) {
    const suffix = `_${n}`;
    const maxBaseLen = MAX_FLOW_CODE_LEN - suffix.length;
    const trimmed = b.slice(0, Math.max(1, maxBaseLen));
    const candidate = `${trimmed}${suffix}`;
    if (!existing.has(candidate)) return candidate;
    n += 1;
  }
  return `${b.slice(0, 40)}_${Date.now()}`;
}

export function isLikelyDuplicateFlowError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("duplicate") ||
    m.includes("unique") ||
    m.includes("already exists") ||
    m.includes("violates unique") ||
    m.includes("23505")
  );
}
