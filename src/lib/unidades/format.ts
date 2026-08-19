/**
 * Formato legible de unidades de medida para la UI (NO cambia el valor guardado en DB).
 * G → Grs · KG → Kg · ML → Ml · L → Lts · UNIDAD → Unidad.
 * Cualquier otro valor se devuelve tal cual (capitalizado si es texto simple).
 */
const MAP: Record<string, string> = {
  G: "Grs",
  KG: "Kg",
  ML: "Ml",
  L: "Lts",
  UNIDAD: "Unidad",
};

export function formatUnidad(u: string | null | undefined): string {
  const raw = (u ?? "").trim();
  if (!raw) return "";
  const key = raw.toUpperCase();
  return MAP[key] ?? raw;
}
