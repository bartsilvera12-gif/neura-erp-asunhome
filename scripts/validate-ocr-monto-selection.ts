/**
 * Validación local del selector de monto OCR (sin DB ni Vision).
 *
 * npx tsx scripts/validate-ocr-monto-selection.ts
 */
import { selectReceiptMontoFromOcrText } from "@/lib/chat/comprobante-ocr-monto-selection";
import { parseMontoOcrDigitsToGs } from "@/lib/chat/comprobante-monto-flow-validation";

function assertEq<T>(label: string, got: T, want: T) {
  if (got !== want) {
    throw new Error(`${label}: esperado ${want}, obtuve ${got}`);
  }
}

function run() {
  const bank = {
    titular: "Abel Serna",
    numero_cuenta: "6192623686",
    alias: "4964636",
  };

  const ocr1 = `
Transferencia
Titular Abel Serna
Cuenta destino 6192623686
Gs. 10.000
`;
  const r1 = selectReceiptMontoFromOcrText(ocr1, {
    expectedMontoGs: 10000,
    toleranciaAbsolutaGs: 0,
    datosBancariosEsperados: bank,
  });
  assertEq("cuenta+monto Gs (digits)", parseMontoOcrDigitsToGs(r1.monto), 10000);

  const ocr2 = `
Gs. 10.000
Para cuenta 6192623686
`;
  const r2 = selectReceiptMontoFromOcrText(ocr2, {
    expectedMontoGs: 10000,
    datosBancariosEsperados: bank,
  });
  assertEq("Gs línea + cuenta larga", parseMontoOcrDigitsToGs(r2.monto), 10000);

  const ocr3 = `Sin monto, solo cuenta\n6192623686`;
  const r3 = selectReceiptMontoFromOcrText(ocr3, {
    datosBancariosEsperados: bank,
  });
  assertEq("solo cuenta excluida → sin monto", r3.monto, "");

  const ocr4 = `
referencia 8877665544332211
Transferencia enviada Gs. 25.000
`;
  const r4 = selectReceiptMontoFromOcrText(ocr4, {
    expectedMontoGs: 25000,
    datosBancariosEsperados: { titular: "", numero_cuenta: "", alias: "" },
  });
  assertEq("ref larga vs monto etiquetado", parseMontoOcrDigitsToGs(r4.monto), 25000);

  const ocr5 = `Algo\n6192623686\n10000`;
  const r5 = selectReceiptMontoFromOcrText(ocr5, {
    expectedMontoGs: 10000,
    datosBancariosEsperados: bank,
  });
  assertEq("esperado 10k entre cuenta y monto", parseMontoOcrDigitsToGs(r5.monto), 10000);

  const ocr6 = `Gs. 100.000`;
  const r6 = selectReceiptMontoFromOcrText(ocr6, {
    expectedMontoGs: 10000,
    toleranciaAbsolutaGs: 0,
    datosBancariosEsperados: { titular: "", numero_cuenta: "", alias: "" },
  });
  assertEq("100k vs esperado 10k (debe elegir 100k)", parseMontoOcrDigitsToGs(r6.monto), 100000);

  console.log("validate-ocr-monto-selection: OK (6 casos)");
}

run();
