import { asuncionRangeBoundsUtc } from "@/lib/fechas/asuncion-bounds";

const TZ = "America/Asuncion";
export const DIAS_OPCIONES = [30, 60, 90];

/** Bordes UTC de "los últimos N días" (Asunción) + etiquetas YYYY-MM-DD. */
export function ultimosDiasBounds(diasRaw: number) {
  const dias = DIAS_OPCIONES.includes(diasRaw) ? diasRaw : 30;
  const hoy = new Date();
  const inicio = new Date(hoy);
  inicio.setDate(inicio.getDate() - dias);
  const hasta = hoy.toLocaleDateString("en-CA", { timeZone: TZ });
  const desde = inicio.toLocaleDateString("en-CA", { timeZone: TZ });
  const { start, end } = asuncionRangeBoundsUtc(desde, hasta);
  return { start, end, desde, hasta, dias };
}
