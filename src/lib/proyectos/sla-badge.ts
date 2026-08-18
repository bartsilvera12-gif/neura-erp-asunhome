/** SLA visual para tarjetas (sin lógica contable compleja en esta iteración). */

export type SlaBadge = "ok" | "por_vencer" | "vencido" | "neutral";

export function slaDeadlineBadge(input: {
  fecha_prometida: string | null | undefined;
  archivado?: boolean | null;
  estado_final?: boolean | null;
}): SlaBadge {
  if (input.archivado || input.estado_final) return "neutral";
  const fp = input.fecha_prometida?.trim();
  if (!fp) return "neutral";
  const t = Date.parse(fp);
  if (!Number.isFinite(t)) return "neutral";
  const now = Date.now();
  const msLeft = t - now;
  const day = 86400000;
  if (msLeft < 0) return "vencido";
  if (msLeft < 2 * day) return "por_vencer";
  return "ok";
}
