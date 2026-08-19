/**
 * Conversión de unidades por familia (masa / volumen / conteo) para el costeo de
 * recetas y el descuento de stock. NO inventa densidades: solo convierte dentro
 * de la misma familia. Unidad base: masa=g, volumen=ml, conteo=unidad.
 *
 * Factores a la unidad base:
 *   masa:   G=1, KG=1000
 *   vol:    ML=1, L=1000, LT=1000
 *   conteo: UNIDAD=1
 */

export type FamiliaUnidad = "masa" | "volumen" | "conteo" | "otro";

const FACTOR: Record<string, number> = {
  G: 1, GR: 1, GRS: 1, GRAMO: 1, GRAMOS: 1,
  KG: 1000, KGS: 1000, KILO: 1000, KILOS: 1000,
  ML: 1, MILILITRO: 1, MILILITROS: 1,
  L: 1000, LT: 1000, LTS: 1000, LITRO: 1000, LITROS: 1000,
  UNIDAD: 1, UNID: 1, U: 1, UN: 1, UNIDADES: 1,
};

const FAMILIA: Record<string, FamiliaUnidad> = {
  G: "masa", GR: "masa", GRS: "masa", GRAMO: "masa", GRAMOS: "masa",
  KG: "masa", KGS: "masa", KILO: "masa", KILOS: "masa",
  ML: "volumen", MILILITRO: "volumen", MILILITROS: "volumen",
  L: "volumen", LT: "volumen", LTS: "volumen", LITRO: "volumen", LITROS: "volumen",
  UNIDAD: "conteo", UNID: "conteo", U: "conteo", UN: "conteo", UNIDADES: "conteo",
};

function key(u: string | null | undefined): string {
  return (u ?? "").trim().toUpperCase();
}

export function familiaUnidad(u: string | null | undefined): FamiliaUnidad {
  return FAMILIA[key(u)] ?? "otro";
}

/** Factor a la unidad base de su familia; null si la unidad es desconocida. */
export function factorUnidad(u: string | null | undefined): number | null {
  const f = FACTOR[key(u)];
  return f ?? null;
}

/** ¿Dos unidades pertenecen a la misma familia conocida (convertibles entre sí)? */
export function unidadesCompatibles(a: string | null | undefined, b: string | null | undefined): boolean {
  const fa = familiaUnidad(a);
  const fb = familiaUnidad(b);
  return fa !== "otro" && fa === fb;
}

/**
 * Convierte `cantidad` desde la unidad `desde` a la unidad `hacia`.
 * Devuelve null si las unidades no son compatibles (familias distintas o desconocidas).
 * Ej: convertirCantidad(250, "G", "KG") = 0.25
 */
export function convertirCantidad(
  cantidad: number,
  desde: string | null | undefined,
  hacia: string | null | undefined
): number | null {
  if (!unidadesCompatibles(desde, hacia)) return null;
  const fDesde = factorUnidad(desde);
  const fHacia = factorUnidad(hacia);
  if (fDesde == null || fHacia == null || fHacia === 0) return null;
  return (cantidad * fDesde) / fHacia;
}
