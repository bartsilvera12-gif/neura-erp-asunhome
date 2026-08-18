/**
 * Normalización central de cantidad/boletos para sorteos en chat_flow_data y option_payload.
 * Evita que quede "invisible" una cantidad guardada bajo alias (cantidad_numeros, boletas, etc.).
 */

function norm(s: string | undefined | null): string {
  return (s ?? "").trim();
}

/** Claves numéricas típicas en flow_data / payloads (sin inferir desde monto). */
export const SORTEO_CANTIDAD_NUMERIC_ALIAS_KEYS = [
  "sorteo_snap_cantidad",
  "sorteo_cantidad_opcion",
  "cantidad_boletos",
  "cantidad_boletas",
  "cantidad_numeros",
  "cantidad_entradas",
  "cantidad",
  "boletos",
  "boletas",
  "numeros",
  "entradas",
  "qty",
  "quantity",
] as const;

export type SorteoCantidadExtractionSource =
  | "flow_data_alias"
  | "canonical"
  | "option_payload"
  | "label"
  | "text_field"
  | "none";

/**
 * Primera cantidad entera ≥ 1 reconocida en un mapa string→string (flow_data preparado).
 */
export function readSorteoCantidadNumericFromMap(data: Record<string, string | undefined>): number | null {
  for (const k of SORTEO_CANTIDAD_NUMERIC_ALIAS_KEYS) {
    const v = norm(data[k]);
    if (!v) continue;
    const n = Number(String(v).replace(",", "."));
    if (Number.isFinite(n) && n >= 1) return Math.trunc(n);
  }
  return null;
}

/**
 * Propaga la primera cantidad válida hacia claves canónicas que usa cierre / grafo.
 */
export function propagateSorteoCantidadAliasesIntoCanonical(data: Record<string, string>): Record<string, string> {
  const q = readSorteoCantidadNumericFromMap(data);
  if (q == null) return data;
  const s = String(q);
  const out = { ...data };
  if (!norm(out.cantidad)) out.cantidad = s;
  if (!norm(out.sorteo_snap_cantidad)) out.sorteo_snap_cantidad = s;
  if (!norm(out.cantidad_boletos)) out.cantidad_boletos = s;
  if (!norm(out.sorteo_cantidad_opcion)) out.sorteo_cantidad_opcion = s;
  return out;
}

export function describeSorteoCantidadExtraction(data: Record<string, string>): {
  cantidad_detected: number | null;
  source: SorteoCantidadExtractionSource;
} {
  const direct = readSorteoCantidadNumericFromMap(data);
  if (direct != null) return { cantidad_detected: direct, source: "flow_data_alias" };
  return { cantidad_detected: null, source: "none" };
}
