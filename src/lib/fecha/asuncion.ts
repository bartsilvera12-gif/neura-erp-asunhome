/**
 * Helpers de fecha calendario en zona horaria de Paraguay (America/Asuncion).
 *
 * Por qué: el server de prod corre en UTC. Usar `new Date()` /
 * `toISOString().slice(0,10)` para "hoy" o como default de formularios hace que,
 * después de ~21:00 PY (medianoche UTC), las fechas salten al día UTC siguiente
 * y las métricas/resúmenes "de hoy" dejen de reflejar ventas/gastos del día PY.
 *
 * Estos helpers usan `Intl` con `timeZone: America/Asuncion`, así que son
 * correctos sin importar el TZ del runtime (server o browser) y sin hardcodear
 * el offset (UTC-3/UTC-4).
 */

export const APP_TIMEZONE = "America/Asuncion";

/** Fecha calendario de Paraguay como `YYYY-MM-DD` (apta para <input type="date"> y comparación). */
export function hoyAsuncionYmd(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: APP_TIMEZONE });
}

/** `YYYY-MM-DD` (en Paraguay) del instante representado por `value` (ISO/Date). */
export function asuncionYmd(value: string | number | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-CA", { timeZone: APP_TIMEZONE });
}

/** ¿`iso` cae en el mismo día calendario (Paraguay) que `now`? */
export function esMismoDiaAsuncion(iso: string, now: Date = new Date()): boolean {
  const a = asuncionYmd(iso);
  return a !== "" && a === hoyAsuncionYmd(now);
}
