/** Errores típicos cuando PostgREST no tiene el schema en la lista permitida (Supabase API → Exposed schemas). */
export function isInvalidPostgrestSchemaError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("invalid schema") ||
    m.includes("pgrst106") ||
    m.includes("schema must be one of") ||
    m.includes("schema debe ser uno de") ||
    m.includes("the schema must be one of")
  );
}

/**
 * Errores esperados cuando el cliente PostgREST apunta a un schema tenant no expuesto o tablas aún no visibles en cache.
 * Usar solo para fallbacks opcionales (p. ej. omnicanal), no para datos críticos en zentra_erp.
 */
export function isUsuariosOmnicanalTenantUnavailableError(message: string | null | undefined): boolean {
  const raw = String(message ?? "");
  if (isInvalidPostgrestSchemaError(raw)) return true;
  const m = raw.toLowerCase();
  return (
    m.includes("schema cache") ||
    m.includes("could not find") ||
    m.includes("does not exist") ||
    (m.includes("relation") && m.includes("does not exist")) ||
    m.includes("undefined_table") ||
    m.includes("42p01") ||
    (m.includes("tabla") && m.includes("no existe"))
  );
}

/** Recorta y limpia mensajes de error para logs (sin credenciales). */
export function sanitizePostgrestErrorForLog(message: string | null | undefined): string {
  let t = String(message ?? "").trim().slice(0, 320);
  t = t.replace(/Bearer\s+[\w._-]+/gi, "Bearer [redacted]");
  return t;
}
