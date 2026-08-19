/**
 * Denominaciones de guaraníes para el arqueo de caja (conteo físico de
 * monedas y billetes). Único lugar donde viven estos valores — tanto el
 * componente de UI como la validación server-side importan de acá.
 */

export type TipoDenominacion = "moneda" | "billete";

export interface Denominacion {
  tipo: TipoDenominacion;
  valor: number;
}

/** Denominaciones vigentes en Paraguay usadas para el arqueo. */
export const DENOMINACIONES: Denominacion[] = [
  { tipo: "moneda", valor: 50 },
  { tipo: "moneda", valor: 100 },
  { tipo: "moneda", valor: 500 },
  { tipo: "moneda", valor: 1000 },
  { tipo: "billete", valor: 2000 },
  { tipo: "billete", valor: 5000 },
  { tipo: "billete", valor: 10000 },
  { tipo: "billete", valor: 20000 },
  { tipo: "billete", valor: 50000 },
  { tipo: "billete", valor: 100000 },
];

/** Una línea del arqueo: denominación, cantidad contada y valor = denominación × cantidad. */
export interface ArqueoItem {
  tipo: TipoDenominacion;
  denominacion: number;
  cantidad: number;
  valor: number;
}

export function calcularTotalArqueo(items: ArqueoItem[]): number {
  return items.reduce((s, it) => s + it.valor, 0);
}

/**
 * Valida y normaliza un arqueo recibido del cliente (server-side): rechaza
 * denominaciones desconocidas, cantidades negativas/no numéricas o filas
 * duplicadas, y recalcula `valor` desde `denominacion * cantidad` (nunca
 * confía en el valor que mande el cliente). Devuelve null si es inválido.
 */
export function normalizarArqueo(raw: unknown): ArqueoItem[] | null {
  if (!Array.isArray(raw)) return null;
  const vistos = new Set<number>();
  const out: ArqueoItem[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") return null;
    const o = it as Record<string, unknown>;
    const denominacion = Number(o.denominacion);
    const cantidad = Number(o.cantidad);
    const tipoRaw = o.tipo === "billete" ? "billete" : o.tipo === "moneda" ? "moneda" : null;
    if (!tipoRaw) return null;
    const match = DENOMINACIONES.find((d) => d.valor === denominacion && d.tipo === tipoRaw);
    if (!match) return null;
    if (vistos.has(denominacion)) return null;
    if (!Number.isFinite(cantidad) || cantidad < 0 || !Number.isInteger(cantidad)) return null;
    vistos.add(denominacion);
    out.push({ tipo: match.tipo, denominacion, cantidad, valor: Math.round(denominacion * cantidad) });
  }
  return out;
}
