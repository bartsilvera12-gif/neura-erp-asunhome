/**
 * Firma XML-DSig (RSA-SHA256, digest SHA-256, C14N exclusivo) sobre el nodo `DE` del rDE SIFEN.
 *
 * El digest referencia el elemento `DE` (namespace e-kuatia). La firma se inserta como
 * hermano posterior a `DE` bajo `rDE` (campos firmados del DE, sin incluir gCamFuFD).
 * Tras firmar, se añade `gCamFuFD` con URL de consulta QR (parámetros + cHashQR) si aún no existe.
 *
 * Nota: validar siempre contra XSD v150 y ambiente de pruebas SET.
 *
 * Stack: node-forge (PKCS#12) + xml-crypto (serverless sin openssl CLI).
 */
import * as forge from "node-forge";
import { SignedXml } from "xml-crypto";
import { createPrivateKey } from "node:crypto";
import {
  SIFEN_EKUATIA_TARGET_NS,
  SIFEN_SIRECEP_DE_V150_XSD_FILE,
} from "./sifen-xsi-schema-location";
import { buildSifenDcarQrUrl, type BuildSifenDcarQrOptions } from "./sifen-dcar-qr";
import { escapeXml } from "./xml";

export type { BuildSifenDcarQrOptions as SifenDocumentoQrParams } from "./sifen-dcar-qr";

const SIFEN_NS = SIFEN_EKUATIA_TARGET_NS;
const XMLNS_XSI = "http://www.w3.org/2001/XMLSchema-instance";
const RDE_SCHEMA_LOC_REL = `${SIFEN_NS} ${SIFEN_SIRECEP_DE_V150_XSD_FILE}`;

/**
 * Normaliza atributos de `rDE` tras firmar: `xsi:schemaLocation` con **archivo relativo** (SET 0160 si va URL https al XSD).
 * El digest firmado es solo del nodo `DE`.
 */
function ensureRdeRootSchemaAttrs(xml: string): string {
  const m = /^([\s\S]*?)(<rDE)(\s[^>]*)?>/i.exec(xml);
  if (!m) return xml;
  const before = m[1] ?? "";
  const tag = m[2] ?? "<rDE";
  let rest = (m[3] ?? "").trimStart();
  if (!rest.startsWith(" ")) rest = rest ? ` ${rest}` : "";
  rest = rest
    .replace(/\s+xmlns:xsi\s*=\s*"[^"]*"/gi, "")
    .replace(/\s+xsi:schemaLocation\s*=\s*"[^"]*"/gi, "")
    .replace(/\s+xsi:schemaLocation\s*=\s*'[^']*'/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (rest.length > 0 && !rest.startsWith(" ")) rest = ` ${rest}`;
  const hasDefaultNs = /\sxmlns\s*=\s*"/.test(rest);
  const base = hasDefaultNs ? rest : ` xmlns="${SIFEN_NS}"${rest}`;
  const fixedRest = `${base} xmlns:xsi="${XMLNS_XSI}" xsi:schemaLocation="${escapeXml(RDE_SCHEMA_LOC_REL)}"`;
  const rebuilt = `${tag}${fixedRest}>`;
  return before + rebuilt + xml.slice(m.index! + m[0].length);
}

const XPATH_DE =
  "/*[local-name(.)='rDE']/*[local-name(.)='DE']";
/**
 * SIFEN / guía e-kuatia: Reference con Enveloped + exclusive C14N (orden obligatorio).
 * El nodo `Signature` va como hermano de `DE` bajo `rDE` (XSD `rDE`: dVerFor, DE, ds:Signature, gCamFuFD).
 * Con esa ubicación, el digest sigue siendo solo del subárbol `DE`; el transform enveloped no elimina
 * nodos (no hay `Signature` dentro de `DE`), pero cumple el perfil de transforms exigido por SET.
 */
const TRANSFORMS_DE = [
  "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
  "http://www.w3.org/2001/10/xml-exc-c14n#",
] as const;
const DIGEST = "http://www.w3.org/2001/04/xmlenc#sha256";
const SIG_ALG = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";

export interface P12KeyMaterial {
  privateKeyPem: string;
  certificatePem: string;
}

/**
 * Extrae clave privada y certificado firmante del .p12.
 */
export function extractKeyAndCertFromP12(p12Buffer: Buffer, password: string): P12KeyMaterial {
  let asn1: forge.asn1.Asn1;
  try {
    const der = forge.util.createBuffer(p12Buffer.toString("binary"));
    asn1 = forge.asn1.fromDer(der);
  } catch {
    throw new Error("El archivo .p12 no es un DER PKCS#12 válido");
  }

  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  } catch {
    throw new Error("No se pudo abrir el .p12 (contraseña incorrecta o archivo corrupto)");
  }

  const pkcs8Bags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const keyBags = p12.getBags({ bagType: forge.pki.oids.keyBag });
  const shrouded = pkcs8Bags[forge.pki.oids.pkcs8ShroudedKeyBag];
  const plain = keyBags[forge.pki.oids.keyBag];

  const privateKey = shrouded?.[0]?.key ?? plain?.[0]?.key;
  if (!privateKey) {
    throw new Error("El .p12 no contiene una clave privada reconocida (pkcs8ShroudedKeyBag/keyBag)");
  }

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certs = certBags[forge.pki.oids.certBag];
  const cert = certs?.[0]?.cert;
  if (!cert) {
    throw new Error("El .p12 no contiene certificado (certBag)");
  }

  return {
    privateKeyPem: forge.pki.privateKeyToPem(privateKey),
    certificatePem: forge.pki.certificateToPem(cert),
  };
}

function anexarCamFuFdSiFalta(xml: string, qr: BuildSifenDcarQrOptions): string {
  if (/<gCamFuFD\b/i.test(xml)) return xml;
  const url = buildSifenDcarQrUrl(xml, qr);
  const bloque = `<gCamFuFD><dCarQR>${escapeXml(url)}</dCarQR></gCamFuFD>`;
  return xml.replace(/<\/rDE>\s*$/i, `${bloque}</rDE>`);
}

/**
 * Firma el documento rDE: referencia el nodo `DE` y coloca `Signature` inmediatamente después de `DE`
 * (hermano bajo `rDE`), alineado al orden del tipo `rDE` en el XSD oficial.
 */
export function signSifenDocumentoXml(
  xmlUtf8: string,
  material: P12KeyMaterial,
  qr: BuildSifenDcarQrOptions
): string {
  const trimmed = xmlUtf8.trim();
  if (!/<\s*DE\b/i.test(trimmed) || !/<\s*rDE\b/i.test(trimmed)) {
    throw new Error("Se esperaba un XML con raíz rDE que contenga un elemento DE para firmar.");
  }

  const privateKey = createPrivateKey({
    key: material.privateKeyPem,
    format: "pem",
  });

  const sig = new SignedXml({
    privateKey,
    publicCert: material.certificatePem,
    signatureAlgorithm: SIG_ALG,
    canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
  });

  sig.addReference({
    xpath: XPATH_DE,
    transforms: [...TRANSFORMS_DE],
    digestAlgorithm: DIGEST,
  });

  sig.computeSignature(trimmed, {
    location: {
      reference: XPATH_DE,
      /** Hermano posterior a `DE` (no dentro de `DE`: el XSD no lo permite). */
      action: "after",
    },
  });

  const rawSigned = sig.getSignedXml();
  return anexarCamFuFdSiFalta(ensureRdeRootSchemaAttrs(rawSigned), qr);
}
