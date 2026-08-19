/**
 * Límites de día / mes en zona horaria Paraguay (America/Asuncion, UTC-4 fijo,
 * sin horario de verano desde 2024) expresados como ISO UTC, para filtrar
 * columnas timestamptz en SQL (`fecha >= start AND fecha <= end`).
 *
 * Helper neutral en `lib/fechas` (no acoplar Reportes/Compras a otro módulo).
 */

const TZ = "America/Asuncion";

/** YYYY-MM-DD del "hoy" en Asunción. */
function asuncionYmd(now: Date): string {
  // en-CA da formato YYYY-MM-DD.
  return now.toLocaleDateString("en-CA", { timeZone: TZ });
}

/** Año y mes (1-12) del "ahora" en Asunción. */
function asuncionYearMonth(now: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "numeric",
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  return { year, month };
}

/** Inicio y fin (inclusive) del día de hoy en Asunción, como ISO UTC. */
export function asuncionDayBoundsUtc(now: Date = new Date()): { start: string; end: string } {
  const ymd = asuncionYmd(now);
  const start = new Date(`${ymd}T00:00:00.000-04:00`);
  const end = new Date(`${ymd}T23:59:59.999-04:00`);
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * Rango [desde, hasta] (YYYY-MM-DD, en Asunción) como ISO UTC inclusivo.
 * Si falta `desde` u `hasta`, cae al inicio/fin del mes actual respectivamente.
 */
export function asuncionRangeBoundsUtc(
  desde?: string | null,
  hasta?: string | null,
  now: Date = new Date()
): { start: string; end: string } {
  const month = asuncionMonthBoundsUtc(now);
  const start = desde ? new Date(`${desde}T00:00:00.000-04:00`).toISOString() : month.start;
  const end = hasta ? new Date(`${hasta}T23:59:59.999-04:00`).toISOString() : month.end;
  return { start, end };
}

/** Inicio y fin (inclusive) del mes actual en Asunción, como ISO UTC. */
export function asuncionMonthBoundsUtc(now: Date = new Date()): { start: string; end: string } {
  const { year, month } = asuncionYearMonth(now);
  const mm = String(month).padStart(2, "0");
  const start = new Date(`${year}-${mm}-01T00:00:00.000-04:00`);
  const nextY = month === 12 ? year + 1 : year;
  const nextM = month === 12 ? 1 : month + 1;
  const nextMM = String(nextM).padStart(2, "0");
  const end = new Date(`${nextY}-${nextMM}-01T00:00:00.000-04:00`);
  end.setMilliseconds(end.getMilliseconds() - 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Límites (inclusive) de un mes `YYYY-MM` en Asunción, como ISO UTC. */
export function asuncionMesBoundsUtc(mes: string): { start: string; end: string } {
  const [y, m] = mes.split("-").map(Number);
  const mm = String(m).padStart(2, "0");
  const start = new Date(`${y}-${mm}-01T00:00:00.000-04:00`);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const end = new Date(`${nextY}-${String(nextM).padStart(2, "0")}-01T00:00:00.000-04:00`);
  end.setMilliseconds(end.getMilliseconds() - 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Mes actual en Asunción como `YYYY-MM`. */
export function mesActualAsuncion(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: TZ }).slice(0, 7);
}

/** Últimos `n` meses (incluye el actual) en Asunción, como `YYYY-MM` desc. */
export function mesesRecientesAsuncion(n: number, now: Date = new Date()): string[] {
  const actual = mesActualAsuncion(now);
  let [y, m] = actual.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}

/** Valida formato `YYYY-MM`; si no, devuelve el mes actual. */
export function normalizarMes(mes?: string | null): string {
  return mes && /^\d{4}-\d{2}$/.test(mes) ? mes : mesActualAsuncion();
}
