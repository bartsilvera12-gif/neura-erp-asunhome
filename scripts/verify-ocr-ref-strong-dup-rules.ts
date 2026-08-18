/**
 * Regresión: reglas de referencia OCR para duplicado fuerte + filtro por datos bancarios esperados.
 *
 * npx tsx scripts/verify-ocr-ref-strong-dup-rules.ts
 */
import assert from "node:assert/strict";
import { ocrReferenciaMatchesConfiguredMerchantIdentifiers } from "../src/lib/chat/comprobante-bank-data-validation";
import { ocrReferenceUsableForStrongDuplicate } from "../src/lib/chat/comprobante-ocr-strong-dup-ref";
import type { DatosBancariosEsperadosConfig } from "../src/lib/chat/comprobante-validation-types";

function refEligibleAfterBankFilter(
  ref: string,
  datos: DatosBancariosEsperadosConfig
): string | null {
  let r = ocrReferenceUsableForStrongDuplicate(ref);
  if (r && ocrReferenciaMatchesConfiguredMerchantIdentifiers(ref, datos)) r = null;
  return r;
}

const emptyDatos: DatosBancariosEsperadosConfig = { titular: "", numero_cuenta: "", alias: "" };

// Corta / blocklist estática
assert.equal(ocrReferenceUsableForStrongDuplicate("6192902141"), null);
assert.equal(ocrReferenceUsableForStrongDuplicate("CONCEPTO"), null);
assert.equal(ocrReferenceUsableForStrongDuplicate("VOLVER"), null);

// Ref transaccional fuerte (>=12) sin bloqueo por merchant
const txRef = "TRX202505031200AB";
assert.equal(ocrReferenceUsableForStrongDuplicate(txRef), txRef);
assert.equal(refEligibleAfterBankFilter(txRef, emptyDatos), txRef);

// Misma ref con cuenta comercio en config → no elegible para duplicado fuerte
const datosCuenta: DatosBancariosEsperadosConfig = {
  titular: "Comercio Demo",
  numero_cuenta: "111222333444",
  alias: "mi.alias.mp",
};
assert.equal(ocrReferenceUsableForStrongDuplicate("111222333444"), "111222333444");
assert.equal(refEligibleAfterBankFilter("111222333444", datosCuenta), null);
assert.equal(ocrReferenciaMatchesConfiguredMerchantIdentifiers("111222333444", datosCuenta), true);

// Alias / RUC en config (dígitos)
const datosAlias: DatosBancariosEsperadosConfig = {
  titular: "RUC 80170499-5",
  numero_cuenta: "",
  alias: "otro",
};
assert.equal(ocrReferenciaMatchesConfiguredMerchantIdentifiers("801704995", datosAlias), true);

console.log("verify-ocr-ref-strong-dup-rules: ok");
