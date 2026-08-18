/**
 * CDC (atributo Id del DE): 44 dígitos según conformación SET / facturacionelectronicapy-xmlgen
 * (`jsonDteAlgoritmos.generateCodigoControl`).
 *
 * Orden base (43) + dígito verificador módulo 11 (pesos 2→11 desde la derecha, reinicio en 2).
 */
const I_TI_DE_FE = "01"; // Factura electrónica (iTiDE=1, 2 dígitos)
/** Nota de crédito electrónica (iTiDE=5 → CDC tipo doc "05"). */
export const I_TI_DE_NCE = "5";

export function padDigits(value: string | number, len: number): string {
  const s = String(value).replace(/\D/g, "");
  if (s.length >= len) return s.slice(-len);
  return s.padStart(len, "0").slice(-len);
}

/** dNumTim: 8 dígitos */
export function normalizarNumeroTimbrado(timbrado: string): string {
  return padDigits(timbrado.replace(/\D/g, ""), 8);
}

/** dEst / dPunExp: 3 dígitos */
export function normalizarCodigoTres(val: string): string {
  return padDigits(val.replace(/\D/g, ""), 3);
}

/** dNumDoc: 7 dígitos desde número de factura ERP */
export function normalizarNumeroDocumentoSifen(numeroFactura: string): string {
  const d = numeroFactura.replace(/\D/g, "");
  if (!d) return "0000001";
  return padDigits(d, 7);
}

/** Fecha AAAAMMDD para tramo CDC (emisión DE). */
export function fechaEmisionCdc(fechaIso: string): string {
  const t = fechaIso.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}${m[2]}${m[3]}`;
  const d = new Date(t);
  if (!Number.isNaN(d.getTime())) {
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
    const da = String(d.getUTCDate()).padStart(2, "0");
    return `${y}${mo}${da}`;
  }
  throw new Error(`Fecha de emisión inválida para CDC: ${fechaIso}`);
}

/**
 * Separa cuerpo del RUC (sin DV) y dígito verificador, para nodos XML (sin relleno forzado).
 */
export function splitRucParaXml(rucRaw: string): { cuerpo: string; dDV: string } {
  const d = rucRaw.replace(/\D/g, "");
  if (d.length < 2) {
    throw new Error("RUC demasiado corto");
  }
  const dDV = d.slice(-1);
  const cuerpo = d.slice(0, -1);
  if (cuerpo.length < 1 || cuerpo.length > 8) {
    throw new Error("Longitud de RUC incompatible con SIFEN");
  }
  return { cuerpo, dDV };
}

/**
 * Valor para nodos XSD `tRuc` (p. ej. `dRucRec`): `DE_Types_v150` exige pattern `[1-9][0-9]*…`,
 * longitud 3–8, **sin ceros a la izquierda**. Rellenar el cuerpo a 8 dígitos con `padDigits` produce
 * valores como `00635623`, que **no** cumplen el patrón y SET devuelve 0160 (“dRucRec es invalido”).
 * @see muestra oficial pysifen: `<dRucRec>4192083</dRucRec>`
 */
export function formatoCuerpoRucTipoTruc(cuerpo: string): string {
  const d = String(cuerpo).replace(/\D/g, "");
  let sig = d.replace(/^0+/, "") || "0";
  if (sig === "0") {
    throw new Error("RUC receptor: el cuerpo no tiene dígitos significativos (ingrese RUC sin el DV o revise el número).");
  }
  if (sig.length > 8) {
    sig = sig.slice(-8);
    sig = sig.replace(/^0+/, "") || "0";
  }
  if (sig === "0" || sig.length < 3) {
    throw new Error(
      `RUC receptor: el cuerpo no cumple tRuc SIFEN (3–8 dígitos, sin cero inicial). Valor normalizado: "${sig}"`
    );
  }
  if (!/^[1-9]/.test(sig)) {
    throw new Error(`RUC receptor: valor tRuc inválido tras normalizar: "${sig}"`);
  }
  return sig;
}

/**
 * DV del CDC (módulo 11, igual `jsonDteAlgoritmos.calcularDigitoVerificador` TIPS, baseMax 11).
 */
export function digitoVerificadorModulo11CdcSet(base43: string): string {
  if (!/^\d{43}$/.test(base43)) {
    throw new Error(`La base CDC debe tener 43 dígitos numéricos; recibido ${base43.length}`);
  }
  let k = 2;
  let v_total = 0;
  for (let i = base43.length; i > 0; i--) {
    if (k > 11) k = 2;
    const v_numero_aux = parseInt(base43.substring(i - 1, i), 10);
    v_total += v_numero_aux * k;
    k += 1;
  }
  const v_resto = v_total % 11;
  const v_digit = v_resto > 1 ? 11 - v_resto : 0;
  return String(v_digit);
}

/** @deprecated Usar `digitoVerificadorModulo11CdcSet` (pesos 2–7 cíclicos no coinciden con SET). */
export function digitoVerificadorModulo11Base43(base43: string): string {
  return digitoVerificadorModulo11CdcSet(base43);
}

export interface CdcFacturaElectronicaInput {
  iTiDE: string;
  dRucEm: string;
  dDVEmi: string;
  dEst: string;
  dPunExp: string;
  numeroFactura: string;
  /** AAAAMMDD (misma fecha calendario que `dFeEmiDE`) */
  fechaEmision: string;
  /** gEmis.iTipCont */
  iTipContEmisor: string;
  /** gOpeDE.iTipEmi (1 = normal) */
  iTipEmi: string;
  /** gOpeDE.dCodSeg (9 dígitos), ya calculado */
  dCodSeg: string;
}

/**
 * Arma la base de 43 dígitos y el CDC de 44 (incluye DV).
 */
/**
 * Desglose de la base de 43 dígitos del CDC (conformación SET) a partir del CDC de 44 dígitos.
 * Posiciones: tipo 2, RUC emisor 8, DV 1, establecimiento 3, punto 3, número documento 7, …
 */
export function parseBase43DesdeCdc44(cdc44: string): {
  tipoDoc2: string;
  rucEm8: string;
  dvEmi: string;
  dEst3: string;
  dPunExp3: string;
  dNumDoc7: string;
  /** AAAAMMDD (8 dígitos) embebidos en el CDC. */
  fechaEmision8: string;
  iTipCont1: string;
  iTipEmi1: string;
  dCodSeg9: string;
} | null {
  const c = cdc44.replace(/\D/g, "");
  if (c.length !== 44) return null;
  const b43 = c.slice(0, 43);
  return {
    tipoDoc2: b43.slice(0, 2),
    rucEm8: b43.slice(2, 10),
    dvEmi: b43.slice(10, 11),
    dEst3: b43.slice(11, 14),
    dPunExp3: b43.slice(14, 17),
    dNumDoc7: b43.slice(17, 24),
    iTipCont1: b43.slice(24, 25),
    fechaEmision8: b43.slice(25, 33),
    iTipEmi1: b43.slice(33, 34),
    dCodSeg9: b43.slice(34, 43),
  };
}

export function generarCdcFacturaElectronica(inp: CdcFacturaElectronicaInput): { cdc: string; dDVId: string; base43: string } {
  const tipoDoc = padDigits(inp.iTiDE.replace(/\D/g, ""), 2);
  const ruc = padDigits(inp.dRucEm.replace(/\D/g, ""), 8);
  const dvE = inp.dDVEmi.replace(/\D/g, "").slice(-1) || "0";
  const est = normalizarCodigoTres(inp.dEst);
  const pe = normalizarCodigoTres(inp.dPunExp);
  const nd = normalizarNumeroDocumentoSifen(inp.numeroFactura);
  const f = inp.fechaEmision.replace(/\D/g, "");
  if (f.length !== 8) throw new Error(`fechaEmision CDC debe ser AAAAMMDD (8 dígitos): ${inp.fechaEmision}`);
  const tipCont = padDigits(inp.iTipContEmisor.replace(/\D/g, ""), 1).slice(-1) || "1";
  const tipEmi = padDigits(inp.iTipEmi.replace(/\D/g, ""), 1).slice(-1) || "1";
  const codSeg = padDigits(inp.dCodSeg.replace(/\D/g, ""), 9).slice(-9);

  const base43 = `${tipoDoc}${ruc}${dvE}${est}${pe}${nd}${tipCont}${f}${tipEmi}${codSeg}`;
  if (base43.length !== 43) {
    throw new Error(`Longitud base CDC inesperada: ${base43.length}`);
  }
  const dv = digitoVerificadorModulo11CdcSet(base43);
  const cdc = `${base43}${dv}`;
  return { cdc, dDVId: dv, base43 };
}

export { I_TI_DE_FE };
