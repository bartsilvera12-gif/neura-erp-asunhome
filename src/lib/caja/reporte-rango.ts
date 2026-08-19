import { asuncionRangeBoundsUtc, mesActualAsuncion } from "@/lib/fechas/asuncion-bounds";

/** YYYY-MM-DD válido, o null. */
function ymd(v: string | null | undefined): string | null {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/**
 * Normaliza los parámetros desde/hasta del reporte de caja.
 * Por defecto: del 1° del mes actual hasta hoy (zona Asunción).
 * Devuelve los bordes UTC para filtrar timestamptz + las etiquetas YYYY-MM-DD.
 */
export function resolverRangoCajas(
  desdeRaw: string | null | undefined,
  hastaRaw: string | null | undefined
): { start: string; end: string; desde: string; hasta: string } {
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Asuncion" });
  const desde = ymd(desdeRaw) ?? `${mesActualAsuncion()}-01`;
  const hasta = ymd(hastaRaw) ?? hoy;
  const { start, end } = asuncionRangeBoundsUtc(desde, hasta);
  return { start, end, desde, hasta };
}
