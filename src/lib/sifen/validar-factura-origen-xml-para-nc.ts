/**
 * Validación estricta del DE de factura origen antes de generar nota de crédito SIFEN.
 * Fuente única de verdad: XML firmado en storage (`xml_firmado_path`).
 */
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { downloadSifenObject } from "./sifen-storage";
import { extractOrigenFiscalDesdeRdeXml, type OrigenFiscalDesdeRdeXml } from "./parse-kude-from-signed-xml";
import {
  fechaEmisionCdc,
  normalizarCodigoTres,
  normalizarNumeroDocumentoSifen,
  normalizarNumeroTimbrado,
  padDigits,
  parseBase43DesdeCdc44,
} from "./sifen-cdc";
import {
  MSG_CONFIG_TIMBRADO_INVALIDA,
  feIniTimbradoAIso,
  rucConfigCoincideConEmisorXml,
  timbradoNumeroValido,
  timbradoOrigenCoincideConCdc,
} from "./validar-timbrado-origen-nc";

export const MSG_NO_XML_FIRMADO_VALIDO =
  "No se puede generar NC porque la factura origen no tiene XML firmado válido en storage.";

export const MSG_XML_INCONSISTENTE_CDC =
  "El XML firmado de la factura contiene datos inconsistentes con el CDC registrado";

export const MSG_TIMBRADO_XML_INVALIDO = "El XML firmado de la factura contiene un timbrado inválido";

export const MSG_TIMBRADO_CONFIG_DESALINEADO =
  "El timbrado de la factura original no coincide con la configuración actual";

export type FacturaElectronicaOrigenNcMin = {
  id: string;
  factura_id: string;
  cdc: string | null;
  xml_firmado_path: string | null;
};

export type FiscalDesdeXmlFirmadoNc = {
  origenFiscal: OrigenFiscalDesdeRdeXml;
  /** Valores canónicos (mismas reglas que al generar el rDE). */
  timbrado_numero: string;
  establecimiento: string;
  punto_expedicion: string;
  timbrado_fecha_inicio_vigencia_iso: string;
  actividad_codigo: string;
  actividad_descripcion: string;
  cdc44: string;
};

export type ValidarXmlFirmadoFacturaOrigenNcResult =
  | { ok: true; fiscal: FiscalDesdeXmlFirmadoNc }
  | { ok: false; status: 400 | 409; message: string };

function rucXmlCoincideConCdc(cdc44: string, orig: OrigenFiscalDesdeRdeXml): boolean {
  const tr = parseBase43DesdeCdc44(cdc44);
  if (!tr) return false;
  const xmlRuc8 = padDigits(String(orig.emisor.dRucEm ?? "").replace(/\D/g, ""), 8);
  const xmlDv = String(orig.emisor.dDVEmi ?? "")
    .replace(/\D/g, "")
    .slice(-1);
  return xmlRuc8 === tr.rucEm8 && xmlDv === tr.dvEmi;
}

function dNumDocXmlCoincideCdc(cdc44: string, dNumDocXml: string): boolean {
  const tr = parseBase43DesdeCdc44(cdc44);
  if (!tr) return false;
  return normalizarNumeroDocumentoSifen(dNumDocXml) === tr.dNumDoc7;
}

/**
 * Descarga solo el XML **firmado**, valida integridad XML↔CDC y alineación con `empresa_sifen_config`.
 */
export async function validarXmlFirmadoFacturaOrigenParaNc(
  supabase: AppSupabaseClient,
  empresaId: string,
  fe: FacturaElectronicaOrigenNcMin,
  opts: { cdcEsperado: string; facturaIdEsperado?: string; numeroFacturaErp?: string | null }
): Promise<ValidarXmlFirmadoFacturaOrigenNcResult> {
  const cdc44 = String(opts.cdcEsperado).replace(/\D/g, "");
  if (cdc44.length !== 44) {
    return {
      ok: false,
      status: 400,
      message: `${MSG_CONFIG_TIMBRADO_INVALIDA}: el CDC de la factura origen no tiene 44 dígitos.`,
    };
  }

  const trCdc = parseBase43DesdeCdc44(cdc44);
  if (!trCdc || trCdc.tipoDoc2 !== "01") {
    return {
      ok: false,
      status: 400,
      message: `${MSG_XML_INCONSISTENTE_CDC}: el CDC no corresponde a una factura electrónica (tipo 01).`,
    };
  }

  if (opts.facturaIdEsperado != null && String(fe.factura_id) !== String(opts.facturaIdEsperado)) {
    return {
      ok: false,
      status: 400,
      message: `${MSG_CONFIG_TIMBRADO_INVALIDA}: el documento electrónico no corresponde a la factura indicada (factura_id distinto).`,
    };
  }

  const path = fe.xml_firmado_path == null ? "" : String(fe.xml_firmado_path).trim();
  if (!path) {
    return { ok: false, status: 400, message: MSG_NO_XML_FIRMADO_VALIDO };
  }

  const bin = await downloadSifenObject(supabase, path);
  if (!bin.ok) {
    return {
      ok: false,
      status: 400,
      message: `${MSG_NO_XML_FIRMADO_VALIDO} Detalle: ${bin.message}`,
    };
  }

  let orig: OrigenFiscalDesdeRdeXml;
  try {
    orig = extractOrigenFiscalDesdeRdeXml(bin.data.toString("utf8"));
  } catch (e) {
    const det = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      status: 400,
      message: `${MSG_NO_XML_FIRMADO_VALIDO} No se pudo leer el DE: ${det}`,
    };
  }

  if (orig.cdcId.replace(/\D/g, "") !== cdc44) {
    return {
      ok: false,
      status: 400,
      message: `${MSG_XML_INCONSISTENTE_CDC}: el Id del DE en el XML no coincide con el CDC guardado en la base.`,
    };
  }

  const tipoOrigen = orig.iTiDE.replace(/\D/g, "").trim();
  const iTiDeNum = Number.parseInt(tipoOrigen.replace(/^0+/, "") || "0", 10);
  if (iTiDeNum !== 1) {
    return {
      ok: false,
      status: 400,
      message: `${MSG_CONFIG_TIMBRADO_INVALIDA}: el documento origen no es factura electrónica (iTiDE distinto de 1).`,
    };
  }

  try {
    const raw = orig.fecha_emision_de.trim();
    if (!raw) {
      return {
        ok: false,
        status: 400,
        message: `${MSG_XML_INCONSISTENTE_CDC}: falta dFeEmiDE en el XML.`,
      };
    }
    const ymd = /^(\d{4}-\d{2}-\d{2})/.exec(raw)?.[1] ?? raw.slice(0, 10);
    const fXml = fechaEmisionCdc(ymd);
    if (fXml !== trCdc.fechaEmision8) {
      return {
        ok: false,
        status: 400,
        message: `${MSG_XML_INCONSISTENTE_CDC}: la fecha de emisión (dFeEmiDE) no coincide con la fecha codificada en el CDC (XML ${fXml} vs CDC ${trCdc.fechaEmision8}).`,
      };
    }
  } catch {
    return {
      ok: false,
      status: 400,
      message: `${MSG_XML_INCONSISTENTE_CDC}: dFeEmiDE inválida o ilegible.`,
    };
  }

  const t = orig.timbrado;
  if (!t.dNumTim.trim() || !t.dEst.trim() || !t.dPunExp.trim() || !t.dFeIniT.trim() || !t.dNumDoc.trim()) {
    return {
      ok: false,
      status: 400,
      message: `${MSG_TIMBRADO_XML_INVALIDO}: faltan nodos obligatorios en gTimb (dNumTim, dEst, dPunExp, dNumDoc o dFeIniT).`,
    };
  }

  if (!timbradoNumeroValido(t)) {
    return { ok: false, status: 400, message: `${MSG_TIMBRADO_XML_INVALIDO} (dNumTim).` };
  }

  if (!timbradoOrigenCoincideConCdc(cdc44, t)) {
    return {
      ok: false,
      status: 400,
      message: `${MSG_XML_INCONSISTENTE_CDC}: establecimiento o punto del XML no coinciden con el CDC.`,
    };
  }

  if (!dNumDocXmlCoincideCdc(cdc44, t.dNumDoc)) {
    return {
      ok: false,
      status: 400,
      message: `${MSG_XML_INCONSISTENTE_CDC}: el número de documento en gTimb (dNumDoc) no coincide con el CDC.`,
    };
  }

  if (!rucXmlCoincideConCdc(cdc44, orig)) {
    return {
      ok: false,
      status: 400,
      message: `${MSG_XML_INCONSISTENTE_CDC}: el RUC del emisor en el XML no coincide con el CDC.`,
    };
  }

  if (opts.numeroFacturaErp != null && String(opts.numeroFacturaErp).trim() !== "") {
    const ndErp = normalizarNumeroDocumentoSifen(String(opts.numeroFacturaErp));
    if (ndErp !== trCdc.dNumDoc7) {
      return {
        ok: false,
        status: 400,
        message: `${MSG_XML_INCONSISTENTE_CDC}: el número de factura en el sistema (${ndErp}) no coincide con el número de documento del CDC / XML (${trCdc.dNumDoc7}).`,
      };
    }
  }

  const { data: cfgRow, error: errCfg } = await supabase
    .from("empresa_sifen_config")
    .select(
      "ruc, timbrado_numero, establecimiento, punto_expedicion, activo, timbrado_fecha_inicio_vigencia, actividad_economica_codigo, actividad_economica_descripcion"
    )
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (errCfg) {
    return { ok: false, status: 400, message: errCfg.message };
  }
  if (!cfgRow) {
    return { ok: false, status: 400, message: "No hay configuración SIFEN para esta empresa." };
  }

  const cfg = cfgRow as Record<string, unknown>;
  if (cfg.activo === false) {
    return {
      ok: false,
      status: 400,
      message: `${MSG_CONFIG_TIMBRADO_INVALIDA}: la configuración SIFEN está inactiva.`,
    };
  }

  if (!rucConfigCoincideConEmisorXml(String(cfg.ruc ?? ""), orig)) {
    return {
      ok: false,
      status: 400,
      message: `${MSG_CONFIG_TIMBRADO_INVALIDA}: el RUC del XML firmado no coincide con empresa_sifen_config.ruc.`,
    };
  }

  const ntXml = normalizarNumeroTimbrado(t.dNumTim);
  const ntCfg = normalizarNumeroTimbrado(String(cfg.timbrado_numero ?? ""));
  const estXml = normalizarCodigoTres(t.dEst);
  const estCfg = normalizarCodigoTres(String(cfg.establecimiento ?? ""));
  const peXml = normalizarCodigoTres(t.dPunExp);
  const peCfg = normalizarCodigoTres(String(cfg.punto_expedicion ?? ""));

  const partes: string[] = [];
  if (ntXml !== ntCfg) partes.push(`timbrado (factura/XML ${ntXml} vs configuración ${ntCfg})`);
  if (estXml !== estCfg) partes.push(`establecimiento (factura/XML ${estXml} vs configuración ${estCfg})`);
  if (peXml !== peCfg) partes.push(`punto de expedición (factura/XML ${peXml} vs configuración ${peCfg})`);
  if (partes.length > 0) {
    return {
      ok: false,
      status: 409,
      message: `${MSG_TIMBRADO_CONFIG_DESALINEADO}: ${partes.join("; ")}. Corregí empresa_sifen_config para que coincida con el DE aprobado antes de emitir notas de crédito.`,
    };
  }

  let timIniIso: string;
  try {
    timIniIso = feIniTimbradoAIso(t.dFeIniT);
  } catch (e) {
    const det = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      status: 400,
      message: `${MSG_TIMBRADO_XML_INVALIDO}: dFeIniT no válida (${det}).`,
    };
  }

  const cActOrigen = orig.actividad.cActEco.trim();
  const dActOrigen = orig.actividad.dDesActEco.trim();
  const cActCfg =
    cfg.actividad_economica_codigo == null ? "" : String(cfg.actividad_economica_codigo).trim();
  const dActCfg =
    cfg.actividad_economica_descripcion == null ? "" : String(cfg.actividad_economica_descripcion).trim();
  const cAct = cActOrigen || cActCfg;
  const dAct = dActOrigen || dActCfg;
  if (!cAct || !dAct) {
    return {
      ok: false,
      status: 400,
      message: `${MSG_CONFIG_TIMBRADO_INVALIDA}: falta actividad económica en el XML y en la configuración.`,
    };
  }

  const cfgTimIni =
    cfg.timbrado_fecha_inicio_vigencia == null ? "" : String(cfg.timbrado_fecha_inicio_vigencia).trim().slice(0, 10);
  if (cfgTimIni && cfgTimIni !== timIniIso) {
    return {
      ok: false,
      status: 409,
      message: `${MSG_TIMBRADO_CONFIG_DESALINEADO}: fecha inicio vigencia timbrado (XML ${timIniIso} vs configuración ${cfgTimIni}).`,
    };
  }

  return {
    ok: true,
    fiscal: {
      origenFiscal: orig,
      timbrado_numero: ntXml,
      establecimiento: estXml,
      punto_expedicion: peXml,
      timbrado_fecha_inicio_vigencia_iso: timIniIso,
      actividad_codigo: cAct,
      actividad_descripcion: dAct,
      cdc44,
    },
  };
}
