/**
 * Recepción **síncrona** del DE en SIFEN TEST (`recibe.wsdl` v150).
 * `xDE` lleva el `rDE` firmado **embebido** (no ZIP como recibe-lote).
 * La respuesta `rProtDe` incluye `gResProc` con el código/motivo que recibe-lote no expone en 0301.
 */
import * as https from "node:https";
import { URL } from "node:url";
import type { AmbienteSifen } from "./types";
import { extractKeyAndCertFromP12 } from "./sign-xml";
import { SIFEN_EKUATIA_TARGET_NS } from "./sifen-xsi-schema-location";
import { SIFEN_WS, urlRecibeSync } from "./sifen-ws-urls";

const SIFEN_NS = SIFEN_EKUATIA_TARGET_NS;
const SOAP_ENV = "http://www.w3.org/2003/05/soap-envelope";

/** @deprecated Usar `SIFEN_WS.test.recibeSync` o `urlRecibeSync("test")`. */
export const SIFEN_TEST_RECIBE_SYNC_SERVICE_URL = SIFEN_WS.test.recibeSync;

const CONTENT_TYPE = "application/xml; charset=utf-8";

export interface EmpresaConfigRecibeDeTest {
  ambiente?: AmbienteSifen;
  certificadoP12: Buffer;
  certificadoPassword: string;
}

export interface RecibeDeSyncParams {
  xmlFirmadoRde: string;
  empresaConfig: EmpresaConfigRecibeDeTest;
  dId?: number;
}

export interface RecibeDeGresProcItem {
  dCodRes: string;
  dMsgRes: string;
}

export interface RecibeDeSyncParsed {
  httpStatus: number;
  soapFault: boolean;
  faultString: string | null;
  /** CDC en rProtDe */
  idCdc: string | null;
  dFecProc: string | null;
  dEstRes: string | null;
  dProtAut: string | null;
  gResProc: RecibeDeGresProcItem[];
  cuerpoSoapCrudo: string;
}

function stripXmlDeclaration(xml: string): string {
  return xml.replace(/^\uFEFF?/, "").replace(/^<\?xml[^?]*\?>\s*/i, "").trim();
}

function generarDId(): number {
  const mod = BigInt("999999999999999");
  let n = Number(BigInt(Date.now()) % mod);
  if (!Number.isFinite(n) || n < 1) n = 1;
  return n;
}

function construirSoapRenviDe(dId: number, rdeInterior: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<env:Envelope xmlns:env="${SOAP_ENV}">` +
    `<env:Header/>` +
    `<env:Body>` +
    `<rEnviDe xmlns="${SIFEN_NS}">` +
    `<dId>${dId}</dId>` +
    `<xDE>` +
    rdeInterior +
    `</xDE>` +
    `</rEnviDe>` +
    `</env:Body>` +
    `</env:Envelope>`
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

/** Busca el primer bloque `rProtDe` en la respuesta (con o sin prefijo). */
function extraerInnerRProtDe(xml: string): string | null {
  const re =
    /<(?:[^/\s:]+:)?rProtDe\b[^>]*>([\s\S]*?)<\/(?:[^/\s:]+:)?rProtDe\b[^>]*>/i;
  const m = xml.match(re);
  return m?.[1] ?? null;
}

export function parsearRespuestaRecibeDeSync(xml: string, httpStatus: number): RecibeDeSyncParsed {
  const lower = xml.toLowerCase();
  if (/<faultstring>/i.test(xml) || /<soap12:fault>/i.test(lower) || /<fault>/i.test(xml)) {
    const fault =
      extraerTextoElemento(xml, "faultstring") ?? extraerTextoElemento(xml, "Reason");
    return {
      httpStatus,
      soapFault: true,
      faultString: fault ?? "Fault SOAP",
      idCdc: null,
      dFecProc: null,
      dEstRes: null,
      dProtAut: null,
      gResProc: [],
      cuerpoSoapCrudo: xml,
    };
  }

  const inner = extraerInnerRProtDe(xml) ?? xml;
  const items: RecibeDeGresProcItem[] = [];
  for (const bloque of extraerBloques(inner, "gResProc")) {
    const c = extraerTextoElemento(bloque, "dCodRes");
    const m = extraerTextoElemento(bloque, "dMsgRes");
    if (c != null && m != null) items.push({ dCodRes: c, dMsgRes: m });
  }

  return {
    httpStatus,
    soapFault: false,
    faultString: null,
    idCdc: extraerTextoElemento(inner, "Id"),
    dFecProc: extraerTextoElemento(inner, "dFecProc"),
    dEstRes: extraerTextoElemento(inner, "dEstRes"),
    dProtAut: extraerTextoElemento(inner, "dProtAut"),
    gResProc: items,
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
 * Envía el `rDE` firmado al endpoint síncrono (recibe) y devuelve `rProtDe` parseado.
 */
export async function recibirDeSifenSync(params: RecibeDeSyncParams): Promise<RecibeDeSyncParsed> {
  const ambiente: AmbienteSifen = params.empresaConfig.ambiente ?? "test";
  if (ambiente !== "test" && ambiente !== "produccion") {
    throw new Error('ambiente debe ser "test" o "produccion".');
  }

  const serviceUrl = urlRecibeSync(ambiente);
  const dId = params.dId ?? generarDId();
  const rdeInterior = stripXmlDeclaration(params.xmlFirmadoRde);
  if (!/<\s*rDE\b/i.test(rdeInterior)) {
    throw new Error("Se esperaba XML firmado con raíz rDE.");
  }

  const soap = construirSoapRenviDe(dId, rdeInterior);

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
      CONTENT_TYPE
    );
    httpStatus = res.status;
    cuerpo = res.body;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const label = ambiente === "produccion" ? "SIFEN producción" : "SIFEN TEST";
    throw new Error(`Fallo HTTPS/mTLS recibe síncrono ${label}: ${msg}`);
  }

  return parsearRespuestaRecibeDeSync(cuerpo, httpStatus);
}

export async function recibirDeSifenTestSync(params: RecibeDeSyncParams): Promise<RecibeDeSyncParsed> {
  return recibirDeSifenSync({
    ...params,
    empresaConfig: { ...params.empresaConfig, ambiente: "test" },
  });
}
