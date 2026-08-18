/** Errores PostgREST / Postgres típicos cuando falta una columna en el schema cache o en la tabla. */
export function isMissingColumnError(message: string | null | undefined, column: string): boolean {
  const m = (message ?? "").toLowerCase();
  const c = column.trim().toLowerCase();
  if (!m || !c) return false;
  if (!m.includes(c)) return false;
  return (
    m.includes("does not exist") ||
    m.includes("could not find") ||
    (m.includes("column") && m.includes("unknown")) ||
    m.includes("schema cache") ||
    m.includes("pgrst204") ||
    m.includes("42703")
  );
}
