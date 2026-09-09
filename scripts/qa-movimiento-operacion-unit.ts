/**
 * QA unitario (sin DB): etiquetas de Operación/Referencia y de Origen para la
 * pantalla de Movimientos de Inventario (trazabilidad).
 * Ejecutar: npx tsx scripts/qa-movimiento-operacion-unit.ts
 */
import {
  ORIGEN_LABEL,
  origenLabel,
  origenBadgeClass,
  operacionLabel,
} from "../src/lib/inventario/movimiento-operacion";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}
let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("OK:", name); }
  catch (e) { console.error("FAIL:", name, e instanceof Error ? e.message : e); process.exit(1); }
}

// ── operacionLabel: casos del requerimiento (MOVIMIENTOS) ──────────────────────
test("Venta VTA-…", () => {
  assert(operacionLabel("venta", "VTA-000123") === "Venta VTA-000123", "venta");
});
test("Guarda RES-…", () => {
  assert(operacionLabel("reserva", "RES-000045") === "Guarda RES-000045", "reserva");
});
test("Anulación de guarda RES-… (referencia ANUL-RES-…)", () => {
  assert(operacionLabel("anulacion_reserva", "ANUL-RES-000045") === "Anulación de guarda RES-000045", "anul reserva");
});
test("Anulación de venta VTA-… (origen nuevo)", () => {
  assert(operacionLabel("anulacion_venta", "ANUL-VTA-000123") === "Anulación de venta VTA-000123", "anul venta");
});
test("Histórico: anulación de venta guardada como ajuste_manual (por prefijo)", () => {
  // Movimientos viejos quedaron con origen 'ajuste_manual' + ref 'ANUL-VTA-…'.
  assert(operacionLabel("ajuste_manual", "ANUL-VTA-000123") === "Anulación de venta VTA-000123", "hist");
});
test("Compra COMP-…", () => {
  assert(operacionLabel("compra", "COMP-000001") === "Compra COMP-000001", "compra");
});
test("Devolución con referencia", () => {
  assert(operacionLabel("devolucion_venta", "DEV-000007").startsWith("Devolución"), "dev");
});
test("Inventario inicial (sin referencia)", () => {
  assert(operacionLabel("inventario_inicial", null) === "Inventario inicial", "inv inicial");
});
test("Ajuste manual sin referencia", () => {
  assert(operacionLabel("ajuste_manual", null) === "Ajuste manual", "ajuste");
});
test("Ajuste manual con nota libre", () => {
  assert(operacionLabel("ajuste_manual", "Corrección conteo") === "Ajuste manual · Corrección conteo", "ajuste nota");
});
test("Venta sin referencia → etiqueta de origen", () => {
  assert(operacionLabel("venta", null) === "Venta", "venta sin ref");
});
test("Movimiento antiguo sin referencia ni origen reconocible → Sin referencia histórica", () => {
  assert(operacionLabel("", null) === "Sin referencia histórica", "sin ref hist");
  assert(operacionLabel("origen_raro_legacy", "") === "Sin referencia histórica", "sin ref hist 2");
});

// ── Completitud de orígenes (antes solo 5; ahora los 13 reales) ────────────────
test("ORIGEN_LABEL cubre los 13 orígenes reales", () => {
  const esperados = [
    "compra","venta","ajuste_manual","inventario_inicial","produccion","devolucion_venta",
    "transferencia","servicio_tecnico","averia","devolucion_proveedor","reserva",
    "anulacion_reserva","anulacion_venta",
  ];
  for (const o of esperados) assert(typeof ORIGEN_LABEL[o as keyof typeof ORIGEN_LABEL] === "string", `falta label ${o}`);
  assert(Object.keys(ORIGEN_LABEL).length === esperados.length, "cantidad de orígenes");
});
test("origenLabel tolera valores desconocidos", () => {
  assert(origenLabel("valor_inexistente") === "Otro", "fallback label");
  assert(origenBadgeClass("valor_inexistente").length > 0, "fallback badge");
  assert(origenLabel("reserva") === "Guarda", "reserva label");
  assert(origenLabel("anulacion_venta") === "Anulación de venta", "anulacion_venta label");
});

console.log(`\n${passed} pruebas OK`);
