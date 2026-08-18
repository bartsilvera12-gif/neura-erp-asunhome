/**
 * Cliente técnico: consulta de resultado de lote SIFEN TEST (consulta-lote).
 *
 * XSD: WS_SiConsLote_v141 — petición `rEnviConsLoteDe`, respuesta `rResEnviConsLoteDe`.
 * mTLS con el mismo .p12 que recibe-lote / firma.
 *
 * URL: la documentación y librerías de referencia POSTean a la ruta que incluye `.wsdl`
 * (mismo criterio que facturacionelectronicapy-setapi).
 */
import * as https from "node:https";
import { URL } from "node:url";
import type { AmbienteSifen } from "./types";
import { extractKeyAndCertFromP12 } from "./sign-xml";
import { SIFEN_WS, urlConsultaLote } from "./sifen-ws-urls";

const SIFEN_NS = "http://ekuatia.set.gov.py/sifen/xsd";
const SOAP_ENV = "http://www.w3.org/2003/05/soap-envelope";

/** @deprecated Usar `SIFEN_WS.test.consultaLote` o `urlConsultaLote("test")`. */
export const SIFEN_TEST_CONSULTA_LOTE_SERVICE_URL = SIFEN_WS.test.consultaLote;

/** SOAP 1.2 action (WS-I Basic Profile; algunos gateways la validan). */
const SOAP_ACTION_CONSULTA_LOTE =
  "http://ekuatia.set.gov.py/sifen/xsd/SiConsLoteDE/consultaLoteDE";

export interface EmpresaConfigConsultaLoteTest {
  ambiente?: AmbienteSifen;
  certificadoP12: Buffer;
  certificadoPassword: string;
}

export interface ConsultarLoteSifenTestParams {
  dProtConsLote: string;
  empresaConfig: EmpresaConfigConsultaLoteTest;
  /** Trazabilidad local; no se envía en el SOAP. */
  facturaElectronicaId?: string;
  dId?: number;
}

export interface ConsultaLoteDetalleProcItem {
  dCodRes: string;
  dMsgRes: string;
}

export interface ConsultaLoteDetalleCdc {
  cdc: string;
  dEstRes: string;
  dProtAut: string | null;
  grupo_res: ConsultaLoteDetalleProcItem[];
}

export interface ConsultaLoteRespuestaParsed {
  dFecProc: string | null;
  dCodResLot: string | null;
  dMsgResLot: string | null;
  detalle_por_cdc: ConsultaLoteDetalleCdc[];
  httpStatus: number;
  cuerpoSoapCrudo: string;
  soapFault: boolean;
  faultString: string | null;
}

function generarDId(): number {
  const mod = BigInt("999999999999999");
  let n = Number(BigInt(Date.now()) % mod);
  if (!Number.isFinite(n) || n < 1) n = 1;
  return n;
}

function escaparXmlTexto(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function construirSoapConsultaLote(dId: number, dProtConsLote: string): string {
  const prot = escaparXmlTexto(dProtConsLote.trim());
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap12:Envelope xmlns:soap12="${SOAP_ENV}" xmlns:xsd="${SIFEN_NS}">` +
    `<soap12:Header/>` +
    `<soap12:Body>` +
    `<xsd:rEnviConsLoteDe>` +
    `<xsd:dId>${dId}</xsd:dId>` +
    `<xsd:dProtConsLote>${prot}</xsd:dProtConsLote>` +
    `</xsd:rEnviConsLoteDe>` +
    `</soap12:Body>` +
    `</soap12:Envelope>`
  );
}

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

function extraerBloques(xml: string, local: string): string[] {
  const re = new RegExp(
    `<(?:[^\\s/>:]+:)?${local}\\b[^>]*>([\\s\\S]*?)</(?:[^\\s/>:]+:)?${local}\\b[^>]*>`,
    "gi"
  );
  const out: string[] = [];
  for (const m of xml.matchAll(re)) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

function parsearGrupoRes(inner: string): ConsultaLoteDetalleProcItem[] {
  const bloques = extraerBloques(inner, "gResProc");
  const items: ConsultaLoteDetalleProcItem[] = [];
  for (const b of bloques) {
    const dCodRes = extraerTextoElemento(b, "dCodRes");
    const dMsgRes = extraerTextoElemento(b, "dMsgRes");
    if (dCodRes != null && dMsgRes != null) {
      items.push({ dCodRes, dMsgRes });
    }
  }
  return items;
}

function parsearDetallePorCdc(xml: string): ConsultaLoteDetalleCdc[] {
  const secciones = extraerBloques(xml, "gResProcLote");
  const detalle: ConsultaLoteDetalleCdc[] = [];
  for (const sec of secciones) {
    const cdc = extraerTextoElemento(sec, "id");
    const dEstRes = extraerTextoElemento(sec, "dEstRes");
    if (cdc == null || dEstRes == null) continue;
    const dProtAutRaw = extraerTextoElemento(sec, "dProtAut");
    detalle.push({
      cdc,
      dEstRes,
      dProtAut: dProtAutRaw == null || dProtAutRaw === "" ? null : dProtAutRaw,
      grupo_res: parsearGrupoRes(sec),
    });
  }
  return detalle;
}

export function parsearRespuestaConsultaLote(xml: string): Omit<
  ConsultaLoteRespuestaParsed,
  "httpStatus"
> {
  const lower = xml.toLowerCase();
  if (/<faultstring>/i.test(xml) || /<soap12:fault>/i.test(xml) || /<fault>/i.test(xml)) {
    const fault =
      extraerTextoElemento(xml, "faultstring") ?? extraerTextoElemento(xml, "Reason");
    return {
      dFecProc: null,
      dCodResLot: null,
      dMsgResLot: null,
      detalle_por_cdc: [],
      cuerpoSoapCrudo: xml,
      soapFault: true,
      faultString: fault ?? "Fault SOAP",
    };
  }

  if (/<parsererror\b/i.test(xml)) {
    return {
      dFecProc: null,
      dCodResLot: null,
      dMsgResLot: null,
      detalle_por_cdc: [],
      cuerpoSoapCrudo: xml,
      soapFault: true,
      faultString: "Respuesta no parseable",
    };
  }

  return {
    dFecProc: extraerTextoElemento(xml, "dFecProc"),
    dCodResLot: extraerTextoElemento(xml, "dCodResLot"),
    dMsgResLot: extraerTextoElemento(xml, "dMsgResLot"),
    detalle_por_cdc: parsearDetallePorCdc(xml),
    cuerpoSoapCrudo: xml,
    soapFault: false,
    faultString: null,
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
 * Consulta el estado de procesamiento de un lote ya enviado (protocolo dProtConsLote).
 */
/**
 * Si el lote ya devolvió filas `gResProcLote`, infiere aprobado/rechazado desde `dEstRes`
 * (solo cuando el DE actual sigue en `enviado`).
 */
export function inferirEstadoSifenTrasConsultaLote(
  estadoActual: string,
  cdcFactura: string | null,
  parsed: ConsultaLoteRespuestaParsed
): { nuevoEstado: "aprobado" | "rechazado" | null; filaRelevante: ConsultaLoteDetalleCdc | null } {
  if (parsed.soapFault) return { nuevoEstado: null, filaRelevante: null };
  if (estadoActual !== "enviado" && estadoActual !== "en_proceso") return { nuevoEstado: null, filaRelevante: null };

  const rows = parsed.detalle_por_cdc;
  if (rows.length === 0) return { nuevoEstado: null, filaRelevante: null };

  const row =
    cdcFactura && rows.some((r) => r.cdc === cdcFactura)
      ? rows.find((r) => r.cdc === cdcFactura)!
      : rows[0];

  const est = row.dEstRes.toLowerCase();
  if (/rechaz/.test(est)) return { nuevoEstado: "rechazado", filaRelevante: row };
  if (/aprob|acept|autoriz|confirm/.test(est)) return { nuevoEstado: "aprobado", filaRelevante: row };
  return { nuevoEstado: null, filaRelevante: row };
}

export async function consultarLoteSifen(
  params: ConsultarLoteSifenTestParams
): Promise<ConsultaLoteRespuestaParsed> {
  const ambiente: AmbienteSifen = params.empresaConfig.ambiente ?? "test";
  if (ambiente !== "test" && ambiente !== "produccion") {
    throw new Error('ambiente debe ser "test" o "produccion".');
  }

  const serviceUrl = urlConsultaLote(ambiente);
  const prot = params.dProtConsLote.trim();
  if (!prot || !/^[0-9]+$/.test(prot)) {
    throw new Error("dProtConsLote inválido: debe ser un número (solo dígitos).");
  }

  const dId = params.dId ?? generarDId();
  const soap = construirSoapConsultaLote(dId, prot);

  const { privateKeyPem, certificatePem } = extractKeyAndCertFromP12(
    params.empresaConfig.certificadoP12,
    params.empresaConfig.certificadoPassword
  );

  const contentType = `application/soap+xml; charset=utf-8; action="${SOAP_ACTION_CONSULTA_LOTE}"`;

  let httpStatus: number;
  let cuerpo: string;
  try {
    const res = await postHttpsMtls(
      serviceUrl,
      soap,
      certificatePem,
      privateKeyPem,
      contentType
    );
    httpStatus = res.status;
    cuerpo = res.body;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const label = ambiente === "produccion" ? "SIFEN producción" : "SIFEN TEST";
    throw new Error(`Fallo HTTPS/mTLS consulta-lote ${label}: ${msg}`);
  }

  const parsed = parsearRespuestaConsultaLote(cuerpo);
  return { ...parsed, httpStatus };
}

export async function consultarLoteSifenTest(
  params: ConsultarLoteSifenTestParams
): Promise<ConsultaLoteRespuestaParsed> {
  return consultarLoteSifen({
    ...params,
    empresaConfig: { ...params.empresaConfig, ambiente: "test" },
  });
}
