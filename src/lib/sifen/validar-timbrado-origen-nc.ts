import { normalizarCodigoTres, normalizarNumeroTimbrado, padDigits } from "./sifen-cdc";
import type { OrigenFiscalDesdeRdeXml } from "./parse-kude-from-signed-xml";

export const MSG_CONFIG_TIMBRADO_INVALIDA = "Configuración de timbrado inválida";

/** Convierte `gTimb.dFeIniT` a `YYYY-MM-DD` si es posible. */
export function feIniTimbradoAIso(s: string): string {
  const t = s.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const py = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (py) {
    const da = py[1].padStart(2, "0");
    const mo = py[2].padStart(2, "0");
    return `${py[3]}-${mo}-${da}`;
  }
  throw new Error(`dFeIniT no reconocida: ${s}`);
}

function soloDigitosRucCfg(cfgRuc: string): { cuerpo8: string; dv: string } | null {
  const d = cfgRuc.replace(/\D/g, "");
  if (d.length < 2) return null;
  return { cuerpo8: padDigits(d.slice(0, -1), 8), dv: d.slice(-1).replace(/\D/g, "").slice(-1) || "0" };
}

/** Compara RUC empresa (config) con `gEmis` del XML origen (tRuc + DV). */
export function rucConfigCoincideConEmisorXml(cfgRuc: string, orig: OrigenFiscalDesdeRdeXml): boolean {
  const parsed = soloDigitosRucCfg(cfgRuc);
  if (!parsed) return false;
  const xmlCuerpo = padDigits(String(orig.emisor.dRucEm ?? "").replace(/\D/g, ""), 8);
  const xmlDv = String(orig.emisor.dDVEmi ?? "")
    .replace(/\D/g, "")
    .slice(-1);
  if (!xmlDv) return false;
  return parsed.cuerpo8 === xmlCuerpo && parsed.dv === xmlDv;
}

/**
 * Establecimiento y punto de expedición codificados en el CDC (43 primeros dígitos),
 * posiciones 12–17 (1-based 12–14 est, 15–17 punto) → índice 0-based 11–16 y 14–16.
 */
export function establePuntoDesdeCdc44(cdc44: string): { dEst: string; dPunExp: string } | null {
  const c = cdc44.replace(/\D/g, "");
  if (c.length !== 44) return null;
  const base43 = c.slice(0, 43);
  return { dEst: base43.slice(11, 14), dPunExp: base43.slice(14, 17) };
}

/** `gTimb` del XML debe alinear con establecimiento/punto del CDC origen. */
export function timbradoOrigenCoincideConCdc(cdc44: string, tim: OrigenFiscalDesdeRdeXml["timbrado"]): boolean {
  const ep = establePuntoDesdeCdc44(cdc44);
  if (!ep) return false;
  return (
    normalizarCodigoTres(tim.dEst) === normalizarCodigoTres(ep.dEst) &&
    normalizarCodigoTres(tim.dPunExp) === normalizarCodigoTres(ep.dPunExp)
  );
}

/** `dNumTim` del XML (8 dígitos) coherente con el tipo de documento en CDC (no forma parte del CDC; solo longitud/contenido). */
export function timbradoNumeroValido(tim: OrigenFiscalDesdeRdeXml["timbrado"]): boolean {
  const n = normalizarNumeroTimbrado(tim.dNumTim);
  return n.length === 8 && /^\d{8}$/.test(n);
}
