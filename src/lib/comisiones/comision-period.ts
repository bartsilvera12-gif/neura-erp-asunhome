/**
 * Período de preview para modo `mensual_penultimo_dia_habil`:
 * desde el día 1 del mes calendario en la zona horaria de la política
 * hasta el penúltimo día hábil del mismo mes (23:59:59.999 local).
 */

export type PeriodBounds = {
  timezone: string;
  modoPeriodo: string;
  fechaInicioLocal: string;
  fechaFinLocal: string;
  /** Inicio inclusivo en UTC (ISO). */
  periodoInicioUtcIso: string;
  /** Fin inclusivo en UTC (ISO). */
  periodoFinUtcIso: string;
  etiquetaMes: string;
};

type LocalParts = {
  y: number;
  mo: number;
  d: number;
  hh: number;
  mi: number;
  ss: number;
};

function readZonedParts(ms: number, tz: string): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
  const parts = fmt.formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    +(parts.find((p) => p.type === type)?.value ?? NaN);
  return {
    y: get("year"),
    mo: get("month"),
    d: get("day"),
    hh: get("hour"),
    mi: get("minute"),
    ss: get("second"),
  };
}

function cmpParts(a: LocalParts, b: LocalParts): number {
  const ka = a.y * 1e10 + a.mo * 1e8 + a.d * 1e6 + a.hh * 1e4 + a.mi * 1e2 + a.ss;
  const kb = b.y * 1e10 + b.mo * 1e8 + b.d * 1e6 + b.hh * 1e4 + b.mi * 1e2 + b.ss;
  return ka === kb ? 0 : ka < kb ? -1 : 1;
}

/** Encuentra el instante UTC que corresponde a una fecha/hora local en `tz`. */
export function utcMillisForLocalWallClock(target: LocalParts, tz: string): number {
  let lo = Date.UTC(target.y, target.mo - 1, target.d - 2, 0, 0, 0);
  let hi = Date.UTC(target.y, target.mo - 1, target.d + 2, 0, 0, 0);
  for (let i = 0; i < 56; i++) {
    const mid = (lo + hi) / 2;
    const p = readZonedParts(mid, tz);
    const c = cmpParts(p, target);
    if (c === 0) return Math.round(mid);
    if (c < 0) lo = mid;
    else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

function daysInMonth(y: number, mo: number): number {
  return new Date(y, mo, 0).getDate();
}

function ymdKey(y: number, mo: number, d: number): string {
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Domingo (0) … sábado (6) en la zona horaria para ese día calendario. */
function weekdayInTz(y: number, mo: number, d: number, tz: string): number {
  const ms = utcMillisForLocalWallClock({ y, mo, d, hh: 12, mi: 0, ss: 0 }, tz);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
  const w = fmt.format(new Date(ms)).slice(0, 3);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[w] ?? 0;
}

function isBusinessDay(y: number, mo: number, d: number, tz: string): boolean {
  const wd = weekdayInTz(y, mo, d, tz);
  return wd !== 0 && wd !== 6;
}

/** Penúltimo día hábil del mes (si hay &lt;2 días hábiles, usa el primero disponible). */
export function penultimateBusinessDayOfMonth(y: number, mo: number, tz: string): number {
  const dim = daysInMonth(y, mo);
  const businessDays: number[] = [];
  for (let d = 1; d <= dim; d++) {
    if (isBusinessDay(y, mo, d, tz)) businessDays.push(d);
  }
  if (businessDays.length === 0) return dim;
  if (businessDays.length === 1) return businessDays[0]!;
  return businessDays[businessDays.length - 2]!;
}

/** Año y mes calendario actual en la zona horaria. */
export function nowYearMonthInTz(now: Date, tz: string): { y: number; mo: number } {
  const p = readZonedParts(now.getTime(), tz);
  return { y: p.y, mo: p.mo };
}

const TZ_FALLBACK = "America/Asuncion";

/**
 * Calcula el período actual según política (timezone + modo).
 * Si `modoPeriodo` no es `mensual_penultimo_dia_habil`, se usa el mismo criterio de mes calendario
 * hasta ayer / fin de mes por compatibilidad (preview solo documenta el modo principal).
 */
export function computePreviewPeriod(
  now: Date,
  timezone: string | undefined,
  modoPeriodo: string | undefined
): PeriodBounds {
  const tz = (timezone ?? "").trim() || TZ_FALLBACK;
  const modo = (modoPeriodo ?? "").trim() || "mensual_penultimo_dia_habil";

  let useTz = tz;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: useTz }).format(now);
  } catch {
    useTz = TZ_FALLBACK;
  }

  const { y, mo } = nowYearMonthInTz(now, useTz);

  const startMs = utcMillisForLocalWallClock({ y, mo, d: 1, hh: 0, mi: 0, ss: 0 }, useTz);

  let lastDay = penultimateBusinessDayOfMonth(y, mo, useTz);
  if (modo !== "mensual_penultimo_dia_habil") {
    lastDay = daysInMonth(y, mo);
  }

  const endMsRaw = utcMillisForLocalWallClock({ y, mo, d: lastDay, hh: 23, mi: 59, ss: 59 }, useTz);
  const endMs = endMsRaw + 999;

  let etiquetaMes: string;
  try {
    etiquetaMes = new Intl.DateTimeFormat("es-PY", {
      month: "long",
      year: "numeric",
      timeZone: useTz,
    }).format(new Date(startMs));
  } catch {
    etiquetaMes = new Intl.DateTimeFormat("es-PY", { month: "long", year: "numeric" }).format(new Date(startMs));
  }

  return {
    timezone: useTz,
    modoPeriodo: modo,
    fechaInicioLocal: ymdKey(y, mo, 1),
    fechaFinLocal: ymdKey(y, mo, lastDay),
    periodoInicioUtcIso: new Date(startMs).toISOString(),
    periodoFinUtcIso: new Date(endMs).toISOString(),
    etiquetaMes,
  };
}

/** Compara fecha-only (YYYY-MM-DD o ISO) con rango inclusive fecha local YYYY-MM-DD. */
export function fechaCortaEnRango(fecha: string | null | undefined, desdeYmd: string, hastaYmd: string): boolean {
  if (!fecha) return false;
  const s = String(fecha).trim();
  const short = s.includes("T") ? s.slice(0, 10) : s.slice(0, 10);
  if (short.length < 10) return false;
  return short >= desdeYmd && short <= hastaYmd;
}
