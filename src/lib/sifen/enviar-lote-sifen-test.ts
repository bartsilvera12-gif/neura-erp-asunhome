/**
 * Cliente técnico: envío de lote asíncrono a SIFEN TEST (recibe-lote).
 *
 * `xDE` = Base64 de un ZIP (application/zip) que contiene un único `xml_file.xml`
 * con el XML del lote (`rLoteDE`), según WS_SiRecepLoteDE / guía DNIT.
 *
 * TLS mutuo: certificado/clave en PEM extraídos del .p12 de la empresa (igual que firma).
 */
import * as https from "node:https";
import { URL } from "node:url";
import JSZip from "jszip";
import type { AmbienteSifen } from "./types";
import { extractKeyAndCertFromP12 } from "./sign-xml";
import { SIFEN_EKUATIA_TARGET_NS } from "./sifen-xsi-schema-location";
import { SIFEN_WS, urlRecepLote } from "./sifen-ws-urls";

/**
 * Nombre del archivo dentro del ZIP enviado en xDE.
 * Debe coincidir con lo que espera SET (mismo criterio que librerías oficiales de referencia: `xml_file.xml`).
 */
const NOMBRE_XML_DENTRO_ZIP = "xml_file.xml";

const SIFEN_NS = SIFEN_EKUATIA_TARGET_NS;
const SOAP_ENV = "http://www.w3.org/2003/05/soap-envelope";

/** @deprecated Usar `SIFEN_WS.test.recepLote` o `urlRecepLote("test")`. */
export const SIFEN_TEST_RECEP_LOTE_SERVICE_URL = SIFEN_WS.test.recepLote;

export interface EmpresaConfigEnvioLoteTest {
  ambiente?: AmbienteSifen;
  certificadoP12: Buffer;
  certificadoPassword: string;
}

export interface EnviarLoteSifenTestParams {
  xmlFirmado: string;
  empresaConfig: EmpresaConfigEnvioLoteTest;
  /** Trazabilidad local; no se envía en el SOAP. */
  facturaElectronicaId?: string;
  /** Identificador de control de envío (dId). Si no se indica, se genera. */
  dId?: number;
  /**
   * Si true, envuelve el firmado en `rLoteDE` dentro de `xml_file.xml` (ZIP), alineado a facturacionelectronicapy-setapi.
   */
  envoltorioRloteDe?: boolean;
}

export interface RecibeLoteRespuestaParsed {
  dCodRes: string | null;
  dMsgRes: string | null;
  dProtConsLote: string | null;
  dFecProc: string | null;
  dTpoProces: number | null;
  /** true si el lote fue recibido / encolado (código oficial 0300). */
  loteRecibido: boolean;
  /** true si no fue encolado (código oficial 0301). */
  loteNoEncolado: boolean;
  httpStatus: number;
  cuerpoSoapCrudo: string;
  /** Traza de la petición HTTPS enviada (mismo contrato que usa el endpoint async recibe-lote). */
  solicitudHttps?: {
    url: string;
    method: string;
    contentType: string;
    soapBodyUtf8: string;
  };
}

function stripXmlDeclaration(xml: string): string {
  return xml.replace(/^\uFEFF?/, "").replace(/^<\?xml[^?]*\?>\s*/i, "").trim();
}

function construirXmlLoteRloteDe(xmlFirmado: string): string {
  const inner = stripXmlDeclaration(xmlFirmado);
  /** `rLoteDE` sin xsi (el `rDE` interior ya trae xmlns e-kuatia). Misma idea que SET.js / ZIP oficial. */
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rLoteDE>\n${inner}\n</rLoteDE>\n`;
}

function generarDId(): number {
  const mod = BigInt("999999999999999");
  let n = Number(BigInt(Date.now()) % mod);
  if (!Number.isFinite(n) || n < 1) n = 1;
  return n;
}

/**
 * Empaqueta `xmlLote` en un ZIP real (DEFLATE), verifica entrada `xml_file.xml` y devuelve Base64 del ZIP.
 */
async function zipLoteXmlAUtf8Base64(xmlLote: string): Promise<string> {
  const zip = new JSZip();
  zip.file(NOMBRE_XML_DENTRO_ZIP, xmlLote);
  const zipBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  const zipSize = zipBuffer.length;
  const reopened = await JSZip.loadAsync(zipBuffer);
  const entry = reopened.file(NOMBRE_XML_DENTRO_ZIP);
  if (!entry) {
    throw new Error(`El ZIP generado no contiene ${NOMBRE_XML_DENTRO_ZIP}`);
  }
  const inner = await entry.async("string");
  if (inner !== xmlLote) {
    throw new Error(`El contenido de ${NOMBRE_XML_DENTRO_ZIP} dentro del ZIP no coincide con el XML del lote`);
  }

  const zipB64 = zipBuffer.toString("base64");
  const plainB64 = Buffer.from(xmlLote, "utf-8").toString("base64");
  if (zipB64 === plainB64) {
    throw new Error("xDE: Base64 del ZIP coincide con Base64 del XML en claro (empaquetado inválido)");
  }

  if (process.env.SIFEN_DEBUG_LOTE_XML === "1") {
    const xmlBytes = Buffer.byteLength(xmlLote, "utf-8");
    console.info(
      `[SIFEN_LOTE_ZIP] zip_bytes=${zipSize} xml_utf8_bytes=${xmlBytes} entry=${NOMBRE_XML_DENTRO_ZIP} xde_source=zip_base64`
    );
  }

  return zipB64;
}

/**
 * Cuerpo SOAP alineado a WS_SiRecepLoteDE: elemento raíz del body `rEnvioLote`
 * (calificado por `xmlns` en el propio elemento), hijos `dId` y `xDE` en el mismo NS.
 * Envelope SOAP 1.2 con prefijo `env:` como en integraciones de referencia (SET.js / guías).
 */
function construirSoapRecibeLote(dId: number, xdeBase64: string): string {
  const xdeEscapado = xdeBase64.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<env:Envelope xmlns:env="${SOAP_ENV}">` +
    `<env:Header/>` +
    `<env:Body>` +
    `<rEnvioLote xmlns="${SIFEN_NS}">` +
    `<dId>${dId}</dId>` +
    `<xDE>${xdeEscapado}</xDE>` +
    `</rEnvioLote>` +
    `</env:Body>` +
    `</env:Envelope>`
  );
}

/** SET acepta `application/xml` en recibe-lote (no exige SOAP 1.2 feature con action). */
const CONTENT_TYPE_RECEP_LOTE = "application/xml; charset=utf-8";

/** Arma el SOAP de recibe-lote (útil para trazas sin mTLS). */
export async function prepararSoapRecibeLoteDe(
  ambiente: AmbienteSifen,
  xmlFirmado: string,
  opts?: { envoltorioRloteDe?: boolean; dId?: number }
): Promise<{
  dId: number;
  url: string;
  method: string;
  contentType: string;
  soapBodyUtf8: string;
}> {
  const dId = opts?.dId ?? generarDId();
  const envoltorio = opts?.envoltorioRloteDe === true;
  const xmlLote = envoltorio
    ? construirXmlLoteRloteDe(xmlFirmado)
    : stripXmlDeclaration(xmlFirmado);
  const xde = await zipLoteXmlAUtf8Base64(xmlLote);
  const soapBodyUtf8 = construirSoapRecibeLote(dId, xde);
  return {
    dId,
    url: urlRecepLote(ambiente),
    method: "POST",
    contentType: CONTENT_TYPE_RECEP_LOTE,
    soapBodyUtf8,
  };
}

/** @deprecated Usar `prepararSoapRecibeLoteDe("test", ...)`. */
export async function prepararSoapRecibeLoteTestDe(
  xmlFirmado: string,
  opts?: { envoltorioRloteDe?: boolean; dId?: number }
) {
  return prepararSoapRecibeLoteDe("test", xmlFirmado, opts);
}

/** Extrae texto de un elemento hoja en respuesta SOAP (prefijo opcional). */
function extraerTextoElemento(xml: string, local: string): string | null {
  const re = new RegExp(
    `<(?:[^\\s/>:]+:)?${local}\\b[^>]*>([\\s\\S]*?)</(?:[^\\s/>:]+:)?${local}\\b[^>]*>`,
    "i"
  );
  const m = xml.match(re);
  if (!m?.[1]) return null;
  const inner = m[1].replace(/<[^>]+>/g, "").trim();
  return inner.length > 0 ? inner : null;
}

function parsearRespuestaRecibeLote(xml: string): Omit<
  RecibeLoteRespuestaParsed,
  "httpStatus" | "loteRecibido" | "loteNoEncolado"
> {
  if (/<parsererror\b/i.test(xml) || /<faultstring>/i.test(xml)) {
    const fault = extraerTextoElemento(xml, "faultstring");
    return {
      dCodRes: null,
      dMsgRes: fault ?? "Respuesta SOAP no parseable o Fault",
      dProtConsLote: null,
      dFecProc: null,
      dTpoProces: null,
      cuerpoSoapCrudo: xml,
    };
  }

  const dCodRes = extraerTextoElemento(xml, "dCodRes");
  const dTpoStr = extraerTextoElemento(xml, "dTpoProces");
  let dTpoProces: number | null = null;
  if (dTpoStr != null && dTpoStr !== "") {
    const n = Number(dTpoStr);
    dTpoProces = Number.isFinite(n) ? n : null;
  }

  return {
    dCodRes,
    dMsgRes: extraerTextoElemento(xml, "dMsgRes"),
    dProtConsLote: extraerTextoElemento(xml, "dProtConsLote"),
    dFecProc: extraerTextoElemento(xml, "dFecProc"),
    dTpoProces,
    cuerpoSoapCrudo: xml,
  };
}

function postHttpsMtls(
  urlStr: string,
  body: string,
  certPem: string,
  keyPem: string,
  contentType: string
): Promise<{ status: number; body: string }> {
  const url = new URL(urlStr);
  const port = url.port ? Number(url.port) : 443;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        port,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        cert: certPem,
        key: keyPem,
        rejectUnauthorized: true,
        headers: {
          "Content-Type": contentType,
          "Content-Length": Buffer.byteLength(body, "utf8"),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (ch) => chunks.push(ch as Buffer));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );
    req.on("error", reject);
    req.write(body, "utf8");
    req.end();
  });
}

/**
 * Envía un DE firmado en lote (recibe-lote) a SIFEN TEST o producción.
 * mTLS con el mismo .p12 que firma el DE.
 */
export async function enviarLoteSifen(
  params: EnviarLoteSifenTestParams
): Promise<RecibeLoteRespuestaParsed> {
  const ambiente: AmbienteSifen = params.empresaConfig.ambiente ?? "test";
  if (ambiente !== "test" && ambiente !== "produccion") {
    throw new Error('ambiente debe ser "test" o "produccion".');
  }

  const serviceUrl = urlRecepLote(ambiente);
  const dId = params.dId ?? generarDId();
  const envoltorio = params.envoltorioRloteDe === true;
  const xmlLote = envoltorio
    ? construirXmlLoteRloteDe(params.xmlFirmado)
    : stripXmlDeclaration(params.xmlFirmado);

  if (process.env.SIFEN_DEBUG_LOTE_XML === "1") {
    const head = xmlLote.slice(0, 4000);
    const tail = xmlLote.length > 4000 ? xmlLote.slice(-800) : "";
    console.info(
      `[SIFEN_DEBUG_LOTE_XML] ambiente=${ambiente} bytes_utf8=${Buffer.byteLength(xmlLote, "utf8")} chars=${xmlLote.length} envoltorio_rLoteDE=${envoltorio}\n--- head ---\n${head}\n--- tail ---\n${tail}`
    );
  }

  const preparado = await prepararSoapRecibeLoteDe(ambiente, params.xmlFirmado, {
    envoltorioRloteDe: params.envoltorioRloteDe,
    dId,
  });
  const soap = preparado.soapBodyUtf8;
  const contentTypeRequest = preparado.contentType;

  const { privateKeyPem, certificatePem } = extractKeyAndCertFromP12(
    params.empresaConfig.certificadoP12,
    params.empresaConfig.certificadoPassword
  );

  let httpStatus: number;
  let cuerpo: string;
  try {
    const res = await postHttpsMtls(
      serviceUrl,
      soap,
      certificatePem,
      privateKeyPem,
      contentTypeRequest
    );
    httpStatus = res.status;
    cuerpo = res.body;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const label = ambiente === "produccion" ? "SIFEN producción" : "SIFEN TEST";
    throw new Error(`Fallo HTTPS/mTLS contra ${label}: ${msg}`);
  }

  const parsed = parsearRespuestaRecibeLote(cuerpo);
  const code = parsed.dCodRes?.trim() ?? "";

  return {
    ...parsed,
    httpStatus,
    loteRecibido: code === "0300",
    loteNoEncolado: code === "0301",
    cuerpoSoapCrudo: cuerpo,
    solicitudHttps: {
      url: serviceUrl,
      method: "POST",
      contentType: contentTypeRequest,
      soapBodyUtf8: soap,
    },
  };
}

/** Envío solo a SIFEN TEST (compatibilidad). */
export async function enviarLoteSifenTest(
  params: EnviarLoteSifenTestParams
): Promise<RecibeLoteRespuestaParsed> {
  return enviarLoteSifen({
    ...params,
    empresaConfig: { ...params.empresaConfig, ambiente: "test" },
  });
}
