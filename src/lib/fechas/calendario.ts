/**
 * Fechas de negocio en calendario local (YYYY-MM-DD), sin corrimientos por UTC.
 * PostgreSQL `date` y `<input type="date">` devuelven/usan cadenas que no deben pasar por toISOString().
 */

/** Normaliza a YYYY-MM-DD sin corrimiento UTC. */
export function toCalendarDateStr(v: string | null | undefined): string {
  if (v == null || v === "") return "";
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

/** Hoy en zona local del navegador/servidor. */
export function hoyYmdLocal(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Mes calendario local que contiene `ref` (no usar cadenas tipo `YYYY-MM-31`).
 * Equivalente a inicio = new Date(y, m, 1) y fin = new Date(y, m + 1, 0) con hora máxima en `hasta`.
 */
export function rangoMesCalendarioLocal(ref: Date = new Date()): { desde: Date; hasta: Date } {
  const y = ref.getFullYear();
  const m0 = ref.getMonth();
  const desde = new Date(y, m0, 1, 0, 0, 0, 0);
  const hasta = new Date(y, m0 + 1, 0, 23, 59, 59, 999);
  return { desde, hasta };
}

/** Primer y último día del mes calendario local (YYYY-MM-DD). */
export function ymdInicioFinMesLocal(ref: Date = new Date()): { inicioYmd: string; finYmd: string } {
  const { desde, hasta } = rangoMesCalendarioLocal(ref);
  return { inicioYmd: hoyYmdLocal(desde), finYmd: hoyYmdLocal(hasta) };
}

/**
 * Rango inclusivo en calendario local (misma idea que getRango + enRango en el dashboard).
 * Cadenas vacías = sin límite en ese extremo. Si ambas vacías, devuelve null (sin filtro).
 * Si solo una fecha, el otro extremo queda abierto (1970…2100).
 */
export function rangoDesdeHastaInputs(desdeStr: string, hastaStr: string): { desde: Date; hasta: Date } | null {
  const dNorm = desdeStr.trim() ? toCalendarDateStr(desdeStr) : "";
  const hNorm = hastaStr.trim() ? toCalendarDateStr(hastaStr) : "";
  if (!dNorm && !hNorm) return null;

  const minDate = new Date(1970, 0, 1, 0, 0, 0, 0);
  const maxDate = new Date(2100, 11, 31, 23, 59, 59, 999);

  let desde = minDate;
  let hasta = maxDate;

  if (dNorm && /^\d{4}-\d{2}-\d{2}$/.test(dNorm)) {
    const [y, m, d] = dNorm.split("-").map(Number);
    desde = new Date(y, m - 1, d, 0, 0, 0, 0);
  }
  if (hNorm && /^\d{4}-\d{2}-\d{2}$/.test(hNorm)) {
    const [y, m, d] = hNorm.split("-").map(Number);
    hasta = new Date(y, m - 1, d, 23, 59, 59, 999);
  }

  if (desde.getTime() > hasta.getTime()) {
    const tmp = desde;
    desde = new Date(hasta.getFullYear(), hasta.getMonth(), hasta.getDate(), 0, 0, 0, 0);
    hasta = new Date(tmp.getFullYear(), tmp.getMonth(), tmp.getDate(), 23, 59, 59, 999);
  }

  return { desde, hasta };
}

/** Inclusive: desde/hasta son fechas con hora (típ. getRango). */
export function enRangoCalendario(ymd: string, desde: Date, hasta: Date): boolean {
  const cal = toCalendarDateStr(ymd);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cal)) return false;
  const ds = `${desde.getFullYear()}-${String(desde.getMonth() + 1).padStart(2, "0")}-${String(desde.getDate()).padStart(2, "0")}`;
  const hs = `${hasta.getFullYear()}-${String(hasta.getMonth() + 1).padStart(2, "0")}-${String(hasta.getDate()).padStart(2, "0")}`;
  return cal >= ds && cal <= hs;
}

/** ¿ymd cae en el mes calendario de `ahora`? */
export function enMesCalendarioActual(ymd: string, ahora: Date = new Date()): boolean {
  const cal = toCalendarDateStr(ymd);
  const y = ahora.getFullYear();
  const m = ahora.getMonth() + 1;
  return cal.startsWith(`${y}-${String(m).padStart(2, "0")}-`);
}

/** Año y mes (1-12) desde YYYY-MM-DD o timestamp (usa solo los primeros 10 caracteres). */
export function ymdAnioMes(ymd: string): { y: number; m: number } | null {
  const cal = toCalendarDateStr(ymd);
  const m = cal.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!m) return null;
  return { y: parseInt(m[1], 10), m: parseInt(m[2], 10) };
}

/** Suma días hábiles/calendario en zona local (emisión crédito). */
export function fechaMasDiasCalendario(ymd: string, dias: number): string {
  const parts = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts || !Number.isFinite(dias)) return toCalendarDateStr(ymd) || ymd;
  const d = new Date(parseInt(parts[1], 10), parseInt(parts[2], 10) - 1, parseInt(parts[3], 10));
  d.setDate(d.getDate() + Math.max(0, Math.floor(dias)));
  return hoyYmdLocal(d);
}

/**
 * Vencimiento de factura mensual (suscripción): mismo mes de emisión en el `dia_vencimiento`
 * (acotado a días del mes). Si ese día ya pasó respecto a la emisión, el vencimiento cae en
 * el mismo día del mes siguiente (nunca suma N días de crédito: evita saltos tipo +30/+34 días).
 */
export function fechaVencimientoSuscripcion(fechaEmisionYmd: string, diaVencimiento: number): string {
  const parts = fechaEmisionYmd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts) return toCalendarDateStr(fechaEmisionYmd) || fechaEmisionYmd;
  const y = parseInt(parts[1], 10);
  const mo = parseInt(parts[2], 10);
  const dim = new Date(y, mo, 0).getDate();
  const dV = Math.min(Math.max(1, diaVencimiento), dim);
  const cand = `${y}-${String(mo).padStart(2, "0")}-${String(dV).padStart(2, "0")}`;
  if (cand >= fechaEmisionYmd) return cand;
  let nm = mo + 1;
  let ny = y;
  if (nm > 12) {
    nm = 1;
    ny++;
  }
  const dim2 = new Date(ny, nm, 0).getDate();
  const dV2 = Math.min(Math.max(1, diaVencimiento), dim2);
  return `${ny}-${String(nm).padStart(2, "0")}-${String(dV2).padStart(2, "0")}`;
}
