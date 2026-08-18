/**
 * Prueba la lógica de parseo de montos promocionales (sin DB).
 * Ejecutar: npx tsx scripts/verify-sorteo-promo-pricing.ts
 */
import { parseSorteoPricingFromFlowData } from "../src/lib/sorteos/sorteo-order-from-chat";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FALLO:", msg);
    process.exit(1);
  }
}

// Promo 3 boletos por 50 mil: solo deben contar campos explícitos o monto bajo precio_fuente=promo
const caso3por50 = parseSorteoPricingFromFlowData({
  cantidad: "3",
  precio_fuente: "promo",
  monto_compra: "50000",
  monto: "60000",
  promo_nombre: "3 entradas por 50 mil",
});
assert(caso3por50.montoCompra === 50000, "3x50: debe preferir monto_compra sobre monto lista");
assert(caso3por50.promoNombre === "3 entradas por 50 mil", "promo_nombre");

// Lista en `monto` no debe usarse si no hay precio_fuente promo
const casoListaSoloMonto = parseSorteoPricingFromFlowData({
  cantidad: "5",
  monto: "100000",
});
assert(
  casoListaSoloMonto.montoCompra === null,
  "sin promo: monto genérico no debe fijar monto_compra RPC"
);

// Conflicto: monto pisado a lista pero monto_promocional intacto (típico tras {{monto}} en un paso)
const casoPisado = parseSorteoPricingFromFlowData({
  cantidad: "5",
  precio_fuente: "promo",
  monto_promocional: "90000",
  monto: "100000",
});
assert(
  casoPisado.montoCompra === 90000,
  "5 boletos: debe leer monto_promocional aunque monto tenga total lista"
);

const casoCanon = parseSorteoPricingFromFlowData({
  cantidad: "3",
  precio_fuente: "promo",
  sorteo_monto_opcion: "50000",
  monto: "60000",
});
assert(casoCanon.montoCompra === 50000, "sorteo_monto_opcion gana sobre monto");

console.log(
  "OK: parseSorteoPricingFromFlowData — 3×50k, lista, 5×90k, sorteo_monto_opcion."
);
