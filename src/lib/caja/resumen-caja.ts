/**
 * Resumen de Caja: agrega una lista de turnos (CajaReporteRow) en un único
 * resumen de efectivo del día/período, comparando el efectivo ESPERADO por el
 * sistema con el efectivo REAL contado al cierre.
 *
 * Es lógica PURA y reutilizable (sin DB, sin React): la usan la pantalla de
 * Reportes → Cierres de caja, Reportes → Ventas por día y los exports Excel de
 * ambos, para que lo que se ve coincida con lo que se descarga.
 *
 * Base conceptual (idéntica a getReporteCajas / cerrarCaja — NO se reinventa):
 *   efectivo_esperado(turno) = monto_apertura
 *                            + ventas en efectivo
 *                            + ingresos manuales (efectivo)
 *                            − egresos (efectivo)
 *                            − retiros (efectivo)
 *                            + ajustes (efectivo, con signo)
 *
 * Doble conteo: una venta en efectivo NO genera un movimiento de caja
 * (createVentaTransaccionalPg no inserta en caja_movimientos), así que
 * "ventas en efectivo" e "otros ingresos" (caja_movimientos tipo='ingreso')
 * son fuentes independientes y sumarlas no duplica dinero.
 */

import type { CajaReporteRow } from "./types";

/** Estado de la comparación efectivo real vs. esperado. */
export type EstadoDiferenciaCaja = "cuadrada" | "sobrante" | "faltante" | "sin_cierre";

/**
 * Resumen de efectivo agregado de un conjunto de turnos de caja.
 * Todos los montos están en guaraníes (enteros). `efectivo_real` y
 * `diferencia` son null cuando todavía no hay cierre registrado (no se asume 0).
 */
export interface ResumenCaja {
  /** Σ saldos de apertura de los turnos (saldo inicial). */
  saldo_inicial: number;
  /** Σ ventas cobradas en efectivo (excluye tarjeta/transferencia/crédito/anuladas). */
  ventas_efectivo: number;
  /** Ingresos manuales de caja en efectivo que no son ventas (+ ajustes positivos). */
  otros_ingresos: number;
  /** Egresos + retiros en efectivo (+ ajustes negativos, en valor absoluto). */
  egresos: number;
  /** Efectivo que el sistema espera en caja = inicial + ventas + otros ingresos − egresos. */
  saldo_esperado: number;
  /** Efectivo realmente contado al cierre. null = todavía sin cierre (caja abierta / en conteo). */
  efectivo_real: number | null;
  /** efectivo_real − saldo_esperado. null cuando no hay cierre. */
  diferencia: number | null;
  /** Estado legible de la diferencia (para el badge). */
  estado: EstadoDiferenciaCaja;
  /** Cantidad de turnos incluidos en el resumen. */
  cajas_total: number;
  /** Turnos ya cerrados (con efectivo contado). */
  cajas_cerradas: number;
  /** Turnos aún abiertos / en conteo (sin efectivo contado). */
  cajas_abiertas: number;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/** Resumen vacío (día/período sin turnos). No inventa saldos ni cierres. */
export function resumenCajaVacio(): ResumenCaja {
  return {
    saldo_inicial: 0,
    ventas_efectivo: 0,
    otros_ingresos: 0,
    egresos: 0,
    saldo_esperado: 0,
    efectivo_real: null,
    diferencia: null,
    estado: "sin_cierre",
    cajas_total: 0,
    cajas_cerradas: 0,
    cajas_abiertas: 0,
  };
}

/**
 * Calcula el Resumen de Caja a partir de las filas de turnos ya filtradas
 * (por fecha y, si aplica, por número de caja). Todas las exclusiones fiscales
 * (ventas anuladas/devueltas, crédito, desglose de pago mixto, movimientos
 * anulados) ya vienen resueltas en cada CajaReporteRow desde el servidor.
 */
export function calcularResumenCaja(filas: CajaReporteRow[]): ResumenCaja {
  const r = resumenCajaVacio();
  if (!filas || filas.length === 0) return r;

  r.cajas_total = filas.length;

  for (const f of filas) {
    r.saldo_inicial += num(f.monto_apertura);
    r.ventas_efectivo += num(f.total_efectivo);
    r.otros_ingresos += num(f.ingresos_efectivo);
    r.egresos += num(f.egresos_efectivo) + num(f.retiros_efectivo);

    // Ajustes: netos por turno. Positivo suma a "otros ingresos", negativo a
    // "egresos" (en valor absoluto). Preserva la identidad del saldo esperado.
    const ajuste = num(f.ajustes_efectivo);
    if (ajuste >= 0) r.otros_ingresos += ajuste;
    else r.egresos += -ajuste;

    if (f.estado === "cerrada") r.cajas_cerradas += 1;
    else r.cajas_abiertas += 1;
  }

  // Idéntico a Σ efectivo_esperado por construcción (arit. entera).
  r.saldo_esperado = r.saldo_inicial + r.ventas_efectivo + r.otros_ingresos - r.egresos;

  // Efectivo real solo si TODOS los turnos del período ya cerraron con conteo.
  // Si alguno sigue abierto / en conteo (monto_cierre_contado null) → "sin cierre":
  // no se asume 0 ni se muestra diferencia (regla del negocio).
  const todosConCierre = filas.every((f) => f.monto_cierre_contado != null);
  if (todosConCierre) {
    r.efectivo_real = filas.reduce((s, f) => s + num(f.monto_cierre_contado), 0);
    r.diferencia = r.efectivo_real - r.saldo_esperado;
    r.estado = r.diferencia === 0 ? "cuadrada" : r.diferencia > 0 ? "sobrante" : "faltante";
  } else {
    r.efectivo_real = null;
    r.diferencia = null;
    r.estado = "sin_cierre";
  }

  return r;
}

/** Etiqueta corta del estado de la diferencia (para UI/Excel). */
export function etiquetaEstadoDiferencia(estado: EstadoDiferenciaCaja): string {
  switch (estado) {
    case "cuadrada":
      return "Caja cuadrada";
    case "sobrante":
      return "Sobrante";
    case "faltante":
      return "Faltante";
    default:
      return "Sin cierre";
  }
}
