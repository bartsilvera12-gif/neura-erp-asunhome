/**
 * País y descripciones de documento receptor para SIFEN (ISO 3166-1 alpha-3 en cPaisRec).
 */

function trimStr(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function normPaisKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Mapa reducido nombre / alias → ISO3 (extensible sin hardcodear empresas). */
const PAIS_TEXTO_A_ISO3: Readonly<Record<string, string>> = {
  PARAGUAY: "PRY",
  PY: "PRY",
  PRY: "PRY",
  PERU: "PER",
  "PERÚ": "PER",
  PER: "PER",
  ARGENTINA: "ARG",
  AR: "ARG",
  ARG: "ARG",
  BRASIL: "BRA",
  BR: "BRA",
  BRA: "BRA",
  BOLIVIA: "BOL",
  BO: "BOL",
  BOL: "BOL",
  CHILE: "CHL",
  CL: "CHL",
  CHL: "CHL",
  COLOMBIA: "COL",
  CO: "COL",
  COL: "COL",
  ECUADOR: "ECU",
  EC: "ECU",
  ECU: "ECU",
  URUGUAY: "URY",
  UY: "URY",
  URY: "URY",
  VENEZUELA: "VEN",
  VE: "VEN",
  VEN: "VEN",
  MEXICO: "MEX",
  MÉXICO: "MEX",
  MX: "MEX",
  MEX: "MEX",
  "ESTADOS UNIDOS": "USA",
  USA: "USA",
  US: "USA",
  ESPAÑA: "ESP",
  ESPANA: "ESP",
  ES: "ESP",
  ESP: "ESP",
};

const ISO3_NOMBRE: Readonly<Record<string, string>> = {
  PRY: "Paraguay",
  PER: "Perú",
  ARG: "Argentina",
  BRA: "Brasil",
  BOL: "Bolivia",
  CHL: "Chile",
  COL: "Colombia",
  ECU: "Ecuador",
  URY: "Uruguay",
  VEN: "Venezuela",
  MEX: "México",
  USA: "Estados Unidos",
  ESP: "España",
};

/**
 * Intenta obtener ISO3 desde texto libre de `clientes.pais`.
 */
export function paisTextoAPaisIso3(paisTexto: string | null | undefined): string | null {
  const t = normPaisKey(trimStr(paisTexto));
  if (!t) return null;
  if (/^[A-Z]{3}$/.test(t)) return t;
  return PAIS_TEXTO_A_ISO3[t] ?? null;
}

/**
 * Código país para receptor extranjero: prioriza columna `sifen_codigo_pais`, luego inferencia desde `pais`.
 */
export function resolveCodigoPaisIso3Receptor(input: {
  sifenCodigoPais: string | null | undefined;
  paisTexto: string | null | undefined;
}): string | null {
  const raw = trimStr(input.sifenCodigoPais).toUpperCase();
  if (/^[A-Z]{3}$/.test(raw)) return raw;
  return paisTextoAPaisIso3(input.paisTexto);
}

export function nombrePaisParaDescripcionSifen(iso3: string): string {
  const c = trimStr(iso3).toUpperCase();
  return ISO3_NOMBRE[c] ?? c;
}

const TIPOS_DOC_REC_VALIDOS = new Set([1, 2, 3, 4, 5, 6, 9]);

export function normalizarTipoDocReceptorSifen(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  if (!Number.isFinite(n)) return null;
  return TIPOS_DOC_REC_VALIDOS.has(n) ? n : null;
}

/**
 * Literal `dDTipIDRec` alineado a `tdDtipDocRec` (enumeración o texto 9–41 para tipo 9).
 */
/**
 * Coherencia SIFEN entre tipo de operación (iTiOpe / GENFE027) y país receptor (cPaisRec / GENFE005):
 * - iTiOpe = 4 (B2F) ⇔ cPaisRec ≠ PRY
 * - iTiOpe ∈ {1,2,3} (B2B/B2C/B2G) ⇔ cPaisRec = PRY
 * Falla antes de generar XML para evitar rechazo SET "Código de país del receptor inválido para el tipo de operación informado".
 */
export function assertCoherenciaTiOpePais(tiOpe: number, codigoPaisIso3: string): void {
  const pais = trimStr(codigoPaisIso3).toUpperCase();
  if (tiOpe === 4) {
    if (!pais || pais === "PRY") {
      throw new Error(
        "Datos del receptor inválidos: operación B2F (iTiOpe=4) requiere país receptor extranjero distinto de PRY."
      );
    }
  } else {
    if (pais !== "PRY") {
      throw new Error(
        "Datos del receptor inválidos: operaciones B2B/B2C/B2G (iTiOpe≠4) requieren país receptor PRY."
      );
    }
  }
}

export function descripcionTipoDocRecepXml(tipo: number, custom: string | null | undefined): string {
  const c = trimStr(custom);
  if (tipo === 9) {
    if (c.length >= 9 && c.length <= 41) return c;
    return "Identificación tributaria extranjera";
  }
  const map: Record<number, string> = {
    1: "Cédula paraguaya",
    2: "Pasaporte",
    3: "Cédula extranjera",
    4: "Carnet de residencia",
    5: "Innominado",
    6: "Tarjeta Diplomática de exoneración fiscal",
  };
  const d = map[tipo];
  if (!d) {
    throw new Error(`tipo_doc_receptor SIFEN inválido: ${tipo} (use 1–6 o 9).`);
  }
  return d;
}
