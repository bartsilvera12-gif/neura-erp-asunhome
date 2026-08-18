/**
 * Namespace objetivo SIFEN / e-kuatia (v150).
 * No usar `xsi:schemaLocation` en `rDE` enviado a SET: la validación interna no coincide con la URL pública y devuelve 0160.
 */
export const SIFEN_EKUATIA_TARGET_NS = "http://ekuatia.set.gov.py/sifen/xsd";

/** URL pública (solo referencia; no usar en xsi:schemaLocation del DE enviado a SET). */
export const SIFEN_SIRECEP_DE_V150_XSD_URL = "https://ekuatia.set.gov.py/sifen/xsd/siRecepDE_v150.xsd";

/** Nombre de archivo en `xsi:schemaLocation` (segundo token, relativo al catálogo SET). */
export const SIFEN_SIRECEP_DE_V150_XSD_FILE = "siRecepDE_v150.xsd";

export function buildSifenSiRecepDeV150SchemaLocation(): string {
  return `${SIFEN_EKUATIA_TARGET_NS} ${SIFEN_SIRECEP_DE_V150_XSD_URL}`;
}
