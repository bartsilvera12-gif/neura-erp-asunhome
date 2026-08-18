/**
 * Validación mínima anti-regresión para parseFacturaPostTipo (POST /api/facturas).
 * Ejecutar: npx tsx scripts/validate-factura-post-tipo.ts
 */
import {
  descripcionLineaFacturaPorDefecto,
  parseFacturaPostTipo,
} from "../src/lib/facturacion/factura-post-tipo";

let failed = 0;

function expect(ok: boolean, input: unknown, wantOk: boolean, wantTipo?: string) {
  const r = parseFacturaPostTipo(input);
  const pass = r.ok === wantOk && (!wantOk || (wantTipo && r.ok && r.tipo === wantTipo));
  if (!pass) {
    console.error("FAIL", { input, wantOk, wantTipo, got: r });
    failed++;
  }
}

expect(true, "contado", true, "contado");
expect(true, "CREDITO", true, "credito");
expect(true, "  Suscripcion ", true, "suscripcion");
expect(false, null, false);
expect(false, undefined, false);
expect(false, "", false);
expect(false, "   ", false);
expect(false, "credito_foo", false);
expect(false, 123, false);
expect(false, "venta", false);

if (
  descripcionLineaFacturaPorDefecto("contado") !== "Venta al contado" ||
  descripcionLineaFacturaPorDefecto("suscripcion") !== "Suscripción" ||
  descripcionLineaFacturaPorDefecto("credito") !== "Venta a crédito"
) {
  console.error("FAIL descripcionLineaFacturaPorDefecto");
  failed++;
}

if (failed > 0) {
  console.error(`\nvalidate-factura-post-tipo: ${failed} fallo(s)`);
  process.exit(1);
}
console.log("validate-factura-post-tipo: OK");
