import type { AppSupabaseClient } from "@/lib/supabase/schema";

export type EscalaPolitica = {
  orden: number;
  desde_monto: number;
  hasta_monto: number | null;
  porcentaje_comision: number;
  premio_fijo: number | null;
};

export type TierResult = {
  escalaOrden: number;
  etiqueta: string;
  porcentaje: number;
  premioFijo: number;
};

export function ordenarEscalas(rows: EscalaPolitica[]): EscalaPolitica[] {
  return [...rows].sort((a, b) => {
    if (a.orden !== b.orden) return a.orden - b.orden;
    return a.desde_monto - b.desde_monto;
  });
}

/**
 * Elige el tramo aplicable según revenue acumulado: el último tramo (por orden/desde)
 * con `desde_monto <= R`. Así el tramo sin techo cubre montos altos.
 */
export function resolverTramo(revenue: number, escalas: EscalaPolitica[]): TierResult | null {
  const sorted = ordenarEscalas(escalas);
  if (sorted.length === 0) return null;
  const R = revenue;
  let candidate: EscalaPolitica | null = null;
  for (const e of sorted) {
    const desde = Number(e.desde_monto) || 0;
    if (R >= desde) candidate = e;
  }
  if (!candidate) return null;
  const desde = Number(candidate.desde_monto) || 0;
  const pct = Number(candidate.porcentaje_comision) || 0;
  const premio = candidate.premio_fijo == null ? 0 : Number(candidate.premio_fijo) || 0;
  const hastaTxt =
    candidate.hasta_monto == null || candidate.hasta_monto === undefined
      ? "∞"
      : String(candidate.hasta_monto);
  return {
    escalaOrden: candidate.orden,
    etiqueta: `${desde} → ${hastaTxt} · ${pct}%`,
    porcentaje: pct,
    premioFijo: premio,
  };
}

export function comisionPorTramo(revenue: number, tier: TierResult | null): number {
  if (!tier || revenue <= 0) return 0;
  const variable = (revenue * tier.porcentaje) / 100;
  const premio = tier.premioFijo > 0 ? tier.premioFijo : 0;
  return variable + premio;
}

export function repartoProporcional(total: number, montos: number[]): number[] {
  const sum = montos.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return montos.map(() => 0);
  const raw = montos.map((m) => (total * m) / sum);
  const rounded = raw.map((x) => Math.round(x * 100) / 100);
  const drift = Math.round((total - rounded.reduce((a, b) => a + b, 0)) * 100) / 100;
  if (rounded.length > 0 && Math.abs(drift) >= 0.005) {
    rounded[rounded.length - 1] = Math.round((rounded[rounded.length - 1]! + drift) * 100) / 100;
  }
  return rounded;
}

export async function cargarNombresUsuarios(
  catalog: AppSupabaseClient,
  ids: string[]
): Promise<Map<string, string>> {
  const uniq = [...new Set(ids)].filter(Boolean);
  const map = new Map<string, string>();
  if (uniq.length === 0) return map;
  const chunk = 120;
  for (let i = 0; i < uniq.length; i += chunk) {
    const slice = uniq.slice(i, i + chunk);
    const { data, error } = await catalog.from("usuarios").select("id, nombre, email").in("id", slice);
    if (error) continue;
    for (const row of data ?? []) {
      const id = String((row as { id?: string }).id ?? "");
      const nombre = String((row as { nombre?: string }).nombre ?? "").trim();
      const email = String((row as { email?: string }).email ?? "").trim();
      map.set(id, nombre || email || id.slice(0, 8));
    }
  }
  return map;
}
