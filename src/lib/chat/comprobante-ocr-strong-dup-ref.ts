/** Referencias OCR cortas o token genérico repetido en muchos comprobantes (ej. mismo dígito OCR en PY). */
export const MIN_OCR_REF_LENGTH_FOR_STRONG_DUPLICATE = 12;

const OCR_REF_STRONG_BLOCKLIST = new Set(
  [
    "CONCEPTO",
    "VOLVER",
    "INICIO",
    "MENU",
    "PAGAR",
    "CANCELAR",
    "CONTINUAR",
    "ACEPTAR",
    "TRANSFERENCIA",
    "OPERACION",
    "OPERACIÓN",
    "COMPROBANTE",
    "IMPORTE",
    "MONTO",
  ].map((s) => s.toUpperCase())
);

/** Solo refs que pueden usarse para bloqueo fuerte entre sesiones. */
export function ocrReferenceUsableForStrongDuplicate(ref: string | null | undefined): string | null {
  const r = (ref ?? "").trim().toUpperCase();
  if (r.length < MIN_OCR_REF_LENGTH_FOR_STRONG_DUPLICATE) return null;
  if (OCR_REF_STRONG_BLOCKLIST.has(r)) return null;
  const compact = r.replace(/[^A-Z0-9]/g, "");
  if (compact.length > 0 && OCR_REF_STRONG_BLOCKLIST.has(compact)) return null;
  return r;
}
