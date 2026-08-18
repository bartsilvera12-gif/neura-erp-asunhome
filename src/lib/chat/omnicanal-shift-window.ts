/**
 * Utilidades para decidir si un agente está "dentro de turno" según un horario omnicanal.
 * Días ISO 8601: 1 = lunes … 7 = domingo. Base para reportes, fuera de turno y asignación futura.
 *
 * Limitación actual: las horas se comparan en la zona horaria **local del proceso** (servidor / navegador).
 * Para cruce de medianoche (ej. 22:00–06:00), soporta time_end < time_start.
 */
export type OmnicanalWorkScheduleShape = {
  time_start: string;
  time_end: string;
  days_of_week: number[] | null;
  is_active: boolean;
};

function timeStringToMinutes(t: string): number {
  const s = t.trim();
  const p = s.split(":");
  const h = Math.max(0, Math.min(23, Number(p[0] ?? 0)));
  const m = Math.max(0, Math.min(59, Number(p[1] ?? 0)));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return h * 60 + m;
}

/** Convierte `Date.getDay()` (0=dom…6=sáb) a ISO 1..7 (1=lun, 7=dom). */
export function localDayIso6801(d: Date): number {
  const j = d.getDay();
  return j === 0 ? 7 : j;
}

/**
 * `true` si el instante `now` cae en la franja y día del horario (y el horario está activo).
 */
export function isNowWithinOmnicanalSchedule(
  row: OmnicanalWorkScheduleShape,
  now: Date = new Date()
): boolean {
  if (!row.is_active) return false;
  const days = (row.days_of_week ?? []).filter((n) => n >= 1 && n <= 7);
  const isoD = localDayIso6801(now);
  if (days.length > 0 && !days.includes(isoD)) return false;

  const cur = now.getHours() * 60 + now.getMinutes();
  const s = timeStringToMinutes(row.time_start);
  const e = timeStringToMinutes(row.time_end);
  if (Number.isNaN(s) || Number.isNaN(e)) return false;

  if (e > s) {
    return cur >= s && cur < e;
  }
  return cur >= s || cur < e;
}
