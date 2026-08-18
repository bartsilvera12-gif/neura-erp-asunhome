/**
 * Coherencia del bloque `gTimb` del rDE de nota de crédito vs el payload esperado (origen FE).
 */
import type { OrigenFiscalDesdeRdeXml } from "./parse-kude-from-signed-xml";
import type { SifenNotaCreditoPayload } from "./types";
import { normalizarCodigoTres, normalizarNumeroTimbrado } from "./sifen-cdc";
import { feIniTimbradoAIso } from "./validar-timbrado-origen-nc";

export const MSG_USUARIO_BLOQUEO_NC_TIMBRADO =
  "No se puede generar la NC porque el timbrado de la factura origen es inválido o inconsistente.";

export type GtimbCampo = "dNumTim" | "dEst" | "dPunExp" | "dFeIniT";

export type GtimbDiferencia = {
  campo: GtimbCampo;
  valor_xml: string;
  valor_esperado: string;
};

export function compararGtimbradoXmlConEmisorPayload(
  parsed: OrigenFiscalDesdeRdeXml,
  emisor: SifenNotaCreditoPayload["emisor"]
): GtimbDiferencia[] {
  const difs: GtimbDiferencia[] = [];
  const expTim = normalizarNumeroTimbrado(emisor.timbrado_numero);
  const gotTim = normalizarNumeroTimbrado(parsed.timbrado.dNumTim);
  if (expTim !== gotTim) {
    difs.push({ campo: "dNumTim", valor_xml: gotTim, valor_esperado: expTim });
  }
  const expEst = normalizarCodigoTres(emisor.establecimiento);
  const gotEst = normalizarCodigoTres(parsed.timbrado.dEst);
  if (expEst !== gotEst) {
    difs.push({ campo: "dEst", valor_xml: gotEst, valor_esperado: expEst });
  }
  const expPe = normalizarCodigoTres(emisor.punto_expedicion);
  const gotPe = normalizarCodigoTres(parsed.timbrado.dPunExp);
  if (expPe !== gotPe) {
    difs.push({ campo: "dPunExp", valor_xml: gotPe, valor_esperado: expPe });
  }
  let expFe: string;
  let gotFe: string;
  try {
    expFe = feIniTimbradoAIso(emisor.timbrado_fecha_inicio_vigencia);
    gotFe = feIniTimbradoAIso(parsed.timbrado.dFeIniT);
  } catch {
    difs.push({
      campo: "dFeIniT",
      valor_xml: String(parsed.timbrado.dFeIniT ?? "").trim(),
      valor_esperado: String(emisor.timbrado_fecha_inicio_vigencia ?? "").trim(),
    });
    return difs;
  }
  if (expFe !== gotFe) {
    difs.push({ campo: "dFeIniT", valor_xml: gotFe, valor_esperado: expFe });
  }
  return difs;
}

export function assertItideNotaCredito(parsed: OrigenFiscalDesdeRdeXml): void {
  const n = Number.parseInt(parsed.iTiDE.replace(/\D/g, "").replace(/^0+/, "") || "0", 10);
  if (n !== 5) {
    throw new Error(`El DE no es nota de crédito electrónica (iTiDE=${parsed.iTiDE}, se esperaba 5).`);
  }
}

export function assertGtimbradoNcCoincideConPayloadOrThrow(
  parsed: OrigenFiscalDesdeRdeXml,
  emisor: SifenNotaCreditoPayload["emisor"]
): void {
  const difs = compararGtimbradoXmlConEmisorPayload(parsed, emisor);
  if (difs.length === 0) return;
  const det = difs.map((d) => `${d.campo}: XML=${d.valor_xml} esperado=${d.valor_esperado}`).join("; ");
  throw new Error(`${MSG_USUARIO_BLOQUEO_NC_TIMBRADO} Detalle: ${det}`);
}
