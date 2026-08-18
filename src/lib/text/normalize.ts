/**
 * Normalizadores de texto compartidos por modulos maestros.
 *
 * Reglas:
 *   - trim + uppercase para campos de identificacion humana (nombres, razon
 *     social, RUC, codigos, descripciones cortas, unidades).
 *   - NO tocar emails, URLs, paths, IDs ni tokens.
 *   - Mantener null/undefined si la entrada no es un string util.
 */

export function normalizeUpperText(v: unknown): string {
  if (v == null) return "";
  return String(v).trim().toUpperCase();
}

export function normalizeUpperNullable(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.toUpperCase() : null;
}

/**
 * Como uppercaseNullable pero preserva el formato del codigo de barras
 * interno (prefijo INT-...) tal cual viene. Solo mayusculiza el resto.
 */
export function normalizeUpperCodigoBarras(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  // Igual mayusculiza el prefijo INT- (ya viene asi del backend) y conserva digitos
  return s.toUpperCase();
}
