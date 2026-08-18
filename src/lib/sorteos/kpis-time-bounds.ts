/**
 * Límites de día y mes calendario en America/Asuncion (PY, UTC−4 fijo),
 * expresados en ISO UTC para filtrar columnas timestamptz en Postgres.
 */

export function asuncionDayBoundsUtc(now = new Date()): { start: string; end: string } {
  const ymd = now.toLocaleDateString("en-CA", { timeZone: "America/Asuncion" });
  const start = new Date(`${ymd}T00:00:00-04:00`);
  const end = new Date(`${ymd}T23:59:59.999-04:00`);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function asuncionMonthBoundsUtc(now = new Date()): { start: string; end: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Asuncion",
    year: "numeric",
    month: "numeric",
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const monthNum = Number(parts.find((p) => p.type === "month")?.value);
  const start = new Date(`${y}-${String(monthNum).padStart(2, "0")}-01T00:00:00-04:00`);
  const nextY = monthNum === 12 ? y + 1 : y;
  const nextM = monthNum === 12 ? 1 : monthNum + 1;
  const end = new Date(
    `${nextY}-${String(nextM).padStart(2, "0")}-01T00:00:00-04:00`
  );
  end.setMilliseconds(end.getMilliseconds() - 1);
  return { start: start.toISOString(), end: end.toISOString() };
}
