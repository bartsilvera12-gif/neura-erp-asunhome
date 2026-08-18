/**
 * Literales y datos genéricos exigidos en ambiente de pruebas SIFEN (SET / e-kuatia).
 * No aplicar en producción.
 */

/** Texto fijo para gEmis.dNomEmi y primer gCamItem.dDesProSer en TEST. */
export const SIFEN_TEST_LITERAL_DOCUMENTO =
  "DOCUMENTO ELECTRÓNICO SIN VALOR COMERCIAL NI FISCAL - GENERADO EN AMBIENTE DE PRUEBA";

/**
 * CSC genérico de pruebas para el cálculo de `dCodSeg` en el DE (no usar el CSC real de producción en TEST).
 * El IdCSC asociado en el manojo de datos de prueba suele informarse aparte en el facturador (no forma parte del XML del DE).
 */
export const SIFEN_TEST_CSC_GENERICO = "123456789";

/** Identificador del CSC en datos de prueba (referencia configuración timbrado–CSC; no se serializa en el nodo DE). */
export const SIFEN_TEST_ID_CSC = "0001";
