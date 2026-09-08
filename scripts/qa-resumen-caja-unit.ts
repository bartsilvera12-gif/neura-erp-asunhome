/**
 * QA unitario (sin DB): Resumen de Caja — efectivo esperado vs. real contado.
 * Cubre los 10 casos del requerimiento + bordes (mezcla cerrada/abierta, ajustes).
 *
 * Ejecutar: npx tsx scripts/qa-resumen-caja-unit.ts
 */
import { calcularResumenCaja, etiquetaEstadoDiferencia } from "../src/lib/caja/resumen-caja";
import type { CajaReporteRow } from "../src/lib/caja/types";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log("OK:", name);
  } catch (e) {
    console.error("FAIL:", name, e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

/** Construye una fila de turno; efectivo_esperado se deriva de sus componentes. */
function mkCaja(p: Partial<CajaReporteRow> & { cerrada?: boolean; contado?: number | null }): CajaReporteRow {
  const monto_apertura = p.monto_apertura ?? 0;
  const total_efectivo = p.total_efectivo ?? 0;
  const ingresos_efectivo = p.ingresos_efectivo ?? 0;
  const egresos_efectivo = p.egresos_efectivo ?? 0;
  const retiros_efectivo = p.retiros_efectivo ?? 0;
  const ajustes_efectivo = p.ajustes_efectivo ?? 0;
  const efectivo_esperado =
    monto_apertura + total_efectivo + ingresos_efectivo - egresos_efectivo - retiros_efectivo + ajustes_efectivo;
  const cerrada = p.cerrada ?? p.contado != null;
  const contado = p.contado ?? null;
  return {
    id: p.id ?? "c1",
    numero_caja: p.numero_caja ?? 1,
    estado: p.estado ?? (cerrada ? "cerrada" : "abierta"),
    fecha_apertura: p.fecha_apertura ?? "2026-09-08T12:00:00.000Z",
    fecha_cierre: p.fecha_cierre ?? (cerrada ? "2026-09-08T20:00:00.000Z" : null),
    abierta_por_nombre: null,
    cerrada_por_nombre: null,
    monto_apertura,
    cantidad_ventas: p.cantidad_ventas ?? 0,
    total_vendido: p.total_vendido ?? total_efectivo,
    total_efectivo,
    total_tarjeta: p.total_tarjeta ?? 0,
    total_transferencia: p.total_transferencia ?? 0,
    ingresos_efectivo,
    egresos_efectivo,
    retiros_efectivo,
    ajustes_efectivo,
    efectivo_esperado,
    monto_esperado_efectivo: cerrada ? efectivo_esperado : null,
    monto_cierre_contado: contado,
    diferencia: cerrada && contado != null ? contado - efectivo_esperado : null,
    observacion_cierre: null,
    arqueo_apertura_json: null,
    arqueo_cierre_json: null,
  };
}

// Caso 1 — Caja normal (cuadrada)
test("Caso 1 — caja cuadrada", () => {
  const r = calcularResumenCaja([
    mkCaja({ monto_apertura: 50_000, total_efectivo: 100_000, ingresos_efectivo: 20_000, egresos_efectivo: 30_000, contado: 140_000 }),
  ]);
  assert(r.saldo_inicial === 50_000, "saldo_inicial");
  assert(r.ventas_efectivo === 100_000, "ventas_efectivo");
  assert(r.otros_ingresos === 20_000, "otros_ingresos");
  assert(r.egresos === 30_000, "egresos");
  assert(r.saldo_esperado === 140_000, "saldo_esperado");
  assert(r.efectivo_real === 140_000, "efectivo_real");
  assert(r.diferencia === 0, "diferencia");
  assert(r.estado === "cuadrada", "estado");
  assert(etiquetaEstadoDiferencia(r.estado) === "Caja cuadrada", "label");
});

// Caso 2 — Faltante
test("Caso 2 — faltante", () => {
  const r = calcularResumenCaja([
    mkCaja({ monto_apertura: 50_000, total_efectivo: 100_000, ingresos_efectivo: 20_000, egresos_efectivo: 30_000, contado: 135_000 }),
  ]);
  assert(r.saldo_esperado === 140_000, "esperado");
  assert(r.diferencia === -5_000, "diferencia");
  assert(r.estado === "faltante", "estado");
});

// Caso 3 — Sobrante
test("Caso 3 — sobrante", () => {
  const r = calcularResumenCaja([
    mkCaja({ monto_apertura: 50_000, total_efectivo: 100_000, ingresos_efectivo: 20_000, egresos_efectivo: 30_000, contado: 145_000 }),
  ]);
  assert(r.diferencia === 5_000, "diferencia");
  assert(r.estado === "sobrante", "estado");
});

// Caso 4 — Venta con tarjeta: no suma a ventas en efectivo
test("Caso 4 — venta con tarjeta no suma a efectivo", () => {
  const r = calcularResumenCaja([mkCaja({ total_tarjeta: 100_000, total_efectivo: 0, contado: 0 })]);
  assert(r.ventas_efectivo === 0, "ventas_efectivo");
  assert(r.saldo_esperado === 0, "esperado");
});

// Caso 5 — Pago mixto: solo la parte efectivo
test("Caso 5 — pago mixto suma solo efectivo", () => {
  const r = calcularResumenCaja([mkCaja({ total_efectivo: 100_000, total_transferencia: 100_000, contado: 100_000 })]);
  assert(r.ventas_efectivo === 100_000, "ventas_efectivo");
  assert(r.saldo_esperado === 100_000, "esperado");
  assert(r.diferencia === 0, "cuadrada");
});

// Caso 6 — Venta anulada: excluida aguas arriba (no entra a total_efectivo)
test("Caso 6 — venta anulada no incrementa esperado", () => {
  const r = calcularResumenCaja([mkCaja({ total_efectivo: 0, contado: 0 })]);
  assert(r.ventas_efectivo === 0, "ventas_efectivo");
  assert(r.saldo_esperado === 0, "esperado");
});

// Caso 7 — Cambio de fecha: recalcula por día
test("Caso 7 — cambio de fecha recalcula", () => {
  const dia8 = calcularResumenCaja([mkCaja({ total_efectivo: 500_000, contado: 500_000 })]);
  const dia7 = calcularResumenCaja([mkCaja({ total_efectivo: 300_000, contado: 300_000 })]);
  assert(dia8.ventas_efectivo === 500_000, "dia8");
  assert(dia7.ventas_efectivo === 300_000, "dia7");
  assert(dia8.ventas_efectivo !== dia7.ventas_efectivo, "distintos");
});

// Caso 8 — Día sin operaciones: ceros, sin NaN, sin cierre
test("Caso 8 — día sin operaciones", () => {
  const r = calcularResumenCaja([]);
  assert(r.ventas_efectivo === 0 && r.otros_ingresos === 0 && r.egresos === 0, "ceros");
  assert(r.saldo_esperado === 0, "esperado 0");
  assert(r.efectivo_real === null, "sin efectivo real");
  assert(r.diferencia === null, "sin diferencia");
  assert(r.estado === "sin_cierre", "estado");
  assert(!Number.isNaN(r.saldo_esperado), "no NaN");
});

// Caso 9 — Sin cierre todavía: no asumir 0
test("Caso 9 — sin cierre no asume 0", () => {
  const r = calcularResumenCaja([mkCaja({ total_efectivo: 1_500_000, estado: "abierta", contado: null })]);
  assert(r.saldo_esperado === 1_500_000, "esperado");
  assert(r.efectivo_real === null, "efectivo real null");
  assert(r.diferencia === null, "diferencia null");
  assert(r.estado === "sin_cierre", "estado");
});

// Caso 10 — Venta que NO genera movimiento automático: no doble conteo
test("Caso 10 — sin doble conteo de la venta", () => {
  const r = calcularResumenCaja([mkCaja({ total_efectivo: 100_000, ingresos_efectivo: 0, contado: 100_000 })]);
  assert(r.ventas_efectivo === 100_000, "ventas_efectivo");
  assert(r.otros_ingresos === 0, "otros_ingresos 0");
  assert(r.saldo_esperado === 100_000, "esperado 100k, no 200k");
});

// Borde — mezcla de turnos cerrados y abiertos ⇒ sin cierre (no muestra diferencia)
test("Borde — mezcla cerrada/abierta ⇒ sin cierre", () => {
  const r = calcularResumenCaja([
    mkCaja({ id: "a", total_efectivo: 200_000, contado: 200_000 }),
    mkCaja({ id: "b", total_efectivo: 300_000, estado: "abierta", contado: null }),
  ]);
  assert(r.ventas_efectivo === 500_000, "ventas");
  assert(r.saldo_esperado === 500_000, "esperado");
  assert(r.efectivo_real === null, "sin efectivo real");
  assert(r.diferencia === null, "sin diferencia");
  assert(r.cajas_cerradas === 1 && r.cajas_abiertas === 1, "conteo turnos");
});

// Borde — ajuste positivo ⇒ otros ingresos; negativo ⇒ egresos; identidad del esperado
test("Borde — ajustes (+/−) y agregación multi-turno", () => {
  const r = calcularResumenCaja([
    mkCaja({ id: "a", monto_apertura: 50_000, total_efectivo: 100_000, ajustes_efectivo: 10_000, contado: null, estado: "abierta" }),
    mkCaja({ id: "b", monto_apertura: 0, total_efectivo: 40_000, ajustes_efectivo: -15_000, contado: null, estado: "abierta" }),
  ]);
  assert(r.saldo_inicial === 50_000, "saldo_inicial");
  assert(r.ventas_efectivo === 140_000, "ventas");
  assert(r.otros_ingresos === 10_000, "ajuste + suma a otros ingresos");
  assert(r.egresos === 15_000, "ajuste − suma a egresos");
  // Identidad: esperado = inicial + ventas + otros ingresos − egresos = Σ efectivo_esperado
  assert(r.saldo_esperado === 50_000 + 140_000 + 10_000 - 15_000, "identidad esperado");
  assert(r.saldo_esperado === 185_000, "esperado 185k");
});

console.log(`\n${passed} pruebas OK`);
