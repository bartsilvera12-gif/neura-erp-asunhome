/**
 * Numeración opcional de cupones (sorteos.coupon_numbering_*).
 * Sin dependencias de DB: usable en tests y en sorteo-order-direct-pg.
 */

export type CouponNumberMode = "correlative" | "random";

/** Misma idea que antes: al menos 4 dígitos; si el número supera 9999, crece el ancho. */
export function formatNumeroCuponDisplay(num: number): string {
  const n = Math.trunc(num);
  if (!Number.isFinite(n) || n < 0) return "0000";
  const s = String(n);
  const width = Math.max(4, s.length);
  return s.padStart(width, "0");
}

export function parseNumeroCuponToInt(numeroCupon: string): number | null {
  const t = numeroCupon.trim();
  if (!/^\d+$/.test(t)) return null;
  const v = parseInt(t, 10);
  return Number.isFinite(v) ? v : null;
}

/**
 * Bloque de `qty` enteros consecutivos ≥ start, todos libres en `used`,
 * y contenidos en [start, limit] si limit no es null.
 */
export function findCorrelativeBlock(
  start: number,
  limit: number | null,
  used: ReadonlySet<number>,
  qty: number
): number | null {
  if (qty < 1 || !Number.isFinite(start) || start < 0) return null;
  let base = Math.trunc(start);
  const lim = limit != null ? Math.trunc(limit) : null;
  if (lim != null && base > lim) return null;

  while (true) {
    if (lim != null && base + qty - 1 > lim) return null;
    let ok = true;
    for (let i = 0; i < qty; i++) {
      const v = base + i;
      if (used.has(v)) {
        ok = false;
        base = v + 1;
        break;
      }
    }
    if (ok) return base;
  }
}

/** Sin repetición; ordena ascendente para respuesta estable. */
export function pickRandomDistinctInRange(
  start: number,
  limit: number,
  used: ReadonlySet<number>,
  qty: number,
  rnd: () => number = Math.random
): number[] | null {
  const lo = Math.trunc(Math.min(start, limit));
  const hi = Math.trunc(Math.max(start, limit));
  const pool: number[] = [];
  for (let n = lo; n <= hi; n++) {
    if (!used.has(n)) pool.push(n);
  }
  if (pool.length < qty) return null;
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = pool[i];
    pool[i] = pool[j]!;
    pool[j] = t!;
  }
  return pool.slice(0, qty).sort((a, b) => a - b);
}

export type SorteoNumberingInput = {
  enabled: boolean;
  start: number | null;
  mode: CouponNumberMode | null;
  limit: number | null;
};

export function validateSorteoNumberingInput(
  input: SorteoNumberingInput
): { ok: true } | { ok: false; message: string } {
  if (!input.enabled) return { ok: true };

  if (input.start == null || !Number.isFinite(input.start) || input.start < 0) {
    return { ok: false, message: "Número inicial inválido (debe ser ≥ 0)." };
  }
  const start = Math.trunc(input.start);

  if (input.mode !== "correlative" && input.mode !== "random") {
    return { ok: false, message: "Modo de numeración inválido." };
  }

  if (input.mode === "random") {
    if (input.limit == null || !Number.isFinite(input.limit)) {
      return { ok: false, message: "El límite máximo es obligatorio en modo aleatorio." };
    }
    const lim = Math.trunc(input.limit);
    if (lim < start) {
      return { ok: false, message: "El límite máximo debe ser mayor o igual al número inicial." };
    }
    return { ok: true };
  }

  /* correlative */
  if (input.limit != null && Number.isFinite(input.limit)) {
    const lim = Math.trunc(input.limit);
    if (lim < start) {
      return { ok: false, message: "El límite máximo debe ser mayor o igual al número inicial." };
    }
  }
  return { ok: true };
}
