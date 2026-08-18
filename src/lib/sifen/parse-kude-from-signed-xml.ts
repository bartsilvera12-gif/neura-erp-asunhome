/**
 * Extrae datos legibles del rDE firmado (SIFEN v150) para armar el KuDE en PDF.
 * Solo lectura del XML; no altera firma ni envío SET.
 */
import { DOMParser } from "@xmldom/xmldom";
import type { Document, Element as XmlElement } from "@xmldom/xmldom";
import { SIFEN_EKUATIA_TARGET_NS } from "./sifen-xsi-schema-location";

const NS = SIFEN_EKUATIA_TARGET_NS;

function parseNumLoose(s: string): number {
  const t = s.replace(/\s/g, "").replace(",", ".");
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : 0;
}

/** Si `dTotIVA` es 0 o ausente pero existen `dIVA5`/`dIVA10`, el total IVA mostrado es la suma de partes (XML / históricos). */
function resolverDTotIva(dTotIVAraw: string, dIVA5raw: string, dIVA10raw: string): string {
  const iv5 = parseNumLoose(dIVA5raw);
  const iv10 = parseNumLoose(dIVA10raw);
  const declared = parseNumLoose(dTotIVAraw);
  const sumPartes = iv5 + iv10;
  if (sumPartes > 0 && declared <= 0) {
    return String(Math.round(sumPartes));
  }
  if (declared > 0) {
    return String(Math.round(declared));
  }
  if (dTotIVAraw.trim() !== "") {
    return dTotIVAraw.trim();
  }
  return sumPartes > 0 ? String(Math.round(sumPartes)) : "0";
}

export type KudeItemRow = {
  codigo: string;
  descripcion: string;
  unidadMedida: string;
  cantidad: string;
  precioUnit: string;
  totalLinea: string;
  /** Monto mostrado en columna Exentas (moneda operación). */
  montoExenta: string;
  montoGrav5: string;
  montoGrav10: string;
};

export type KudeParsedFromXml = {
  cdc: string;
  dFeEmiDE: string;
  dCarQR: string | null;
  monedaCodigo: string;
  monedaDescripcion: string;
  timbrado: {
    dNumTim: string;
    dEst: string;
    dPunExp: string;
    dNumDoc: string;
    dFeIniT: string;
  };
  emisor: {
    dRucEm: string;
    dDVEmi: string;
    dNomEmi: string;
    dDirEmi: string;
    dTelEmi: string;
    dEmailE: string;
  };
  receptor: {
    nombre: string;
    docLabel: string;
    docValue: string;
    direccion: string;
    telefono: string;
  };
  operacion: {
    condicionVenta: string;
    tipoOperacion: string;
  };
  totales: {
    dSubExe: string;
    dSub5: string;
    dSub10: string;
    dTotOpe: string;
    dTotGralOpe: string;
    dIVA5: string;
    dIVA10: string;
    dBaseGrav5: string;
    dBaseGrav10: string;
    dTBasGraIVA: string;
    /** Coherente con liquidación (prioriza dIVA5+dIVA10 si aplica). */
    dTotIVA: string;
  };
  items: KudeItemRow[];
};

function textOf(el: XmlElement | null | undefined): string {
  return el?.textContent?.trim() ?? "";
}

function firstNs(parent: XmlElement | undefined, tag: string): XmlElement | undefined {
  if (!parent) return undefined;
  return parent.getElementsByTagNameNS(NS, tag)[0] as XmlElement | undefined;
}

function parseRdeRoot(doc: Document): XmlElement {
  const rde =
    (doc.getElementsByTagNameNS(NS, "rDE")[0] as XmlElement | undefined) ??
    (doc.documentElement?.localName === "rDE" ? (doc.documentElement as XmlElement) : undefined);
  if (!rde) throw new Error("rDE no encontrado");
  return rde;
}

function tagTextOrZero(gTotSub: XmlElement, tag: string): string {
  const t = textOf(firstNs(gTotSub, tag));
  return t === "" ? "0" : t;
}

/**
 * Reparte `dTotOpeItem` en columnas Exentas / 5% / 10% según `gCamIVA` del ítem.
 */
function columnasMontosPorItem(totalLineaStr: string, gIva: XmlElement | undefined): {
  exenta: string;
  g5: string;
  g10: string;
} {
  const tot = totalLineaStr.trim() || "0";
  if (!gIva) {
    return { exenta: tot, g5: "0", g10: "0" };
  }
  const iAfec = textOf(firstNs(gIva, "iAfecIVA"));
  const tasa = parseNumLoose(textOf(firstNs(gIva, "dTasaIVA")));
  const liq = parseNumLoose(textOf(firstNs(gIva, "dLiqIVAItem")));
  /** Tasa y liquidación del ítem prevalecen sobre iAfec=exento mal cargado en algunos XML. */
  if (liq > 0) {
    if (Math.abs(tasa - 5) < 0.6) return { exenta: "0", g5: tot, g10: "0" };
    if (Math.abs(tasa - 10) < 0.6 || tasa >= 9) return { exenta: "0", g5: "0", g10: tot };
  }
  if (Math.abs(tasa - 5) < 0.1) {
    return { exenta: "0", g5: tot, g10: "0" };
  }
  if (Math.abs(tasa - 10) < 0.1 || (tasa >= 9 && tasa <= 11)) {
    return { exenta: "0", g5: "0", g10: tot };
  }
  if (iAfec === "3" || tasa === 0) {
    return { exenta: tot, g5: "0", g10: "0" };
  }
  if (iAfec === "1") {
    if (tasa <= 5.5) return { exenta: "0", g5: tot, g10: "0" };
    return { exenta: "0", g5: "0", g10: tot };
  }
  return { exenta: tot, g5: "0", g10: "0" };
}

/** Datos fiscales mínimos del DE origen (p. ej. para alinear nota de crédito con la FE aprobada). */
export type OrigenFiscalDesdeRdeXml = {
  /** Atributo `Id` del nodo `DE` (CDC, 44 dígitos). */
  cdcId: string;
  /** `gTimb.iTiDE` (p. ej. "1" factura electrónica). */
  iTiDE: string;
  timbrado: {
    dNumTim: string;
    dEst: string;
    dPunExp: string;
    dNumDoc: string;
    dFeIniT: string;
  };
  actividad: {
    cActEco: string;
    dDesActEco: string;
  };
  emisor: {
    dRucEm: string;
    dDVEmi: string;
  };
  /** `gDatGralOpe.dFeEmiDE` (ISO / SET) — coherencia con fecha en CDC. */
  fecha_emision_de: string;
};

/**
 * Lee `gTimb`, `gActEco` y RUC emisor del rDE (firmado o no), sin validar firma.
 * Usado para que la NC reutilice timbrado / establecimiento / punto de la factura origen.
 */
export function extractOrigenFiscalDesdeRdeXml(xmlUtf8: string): OrigenFiscalDesdeRdeXml {
  const doc = new DOMParser().parseFromString(xmlUtf8, "application/xml");
  const parseErr = doc.getElementsByTagName("parsererror")[0];
  if (parseErr) throw new Error("XML inválido (parsererror)");

  const rde = parseRdeRoot(doc);
  const de = firstNs(rde, "DE");
  if (!de) throw new Error("DE no encontrado");

  const idDe = de.getAttribute("Id")?.trim();
  if (!idDe) throw new Error("DE sin atributo Id (CDC)");
  const cdcId = idDe;

  const gDatGralOpe = firstNs(de, "gDatGralOpe");
  if (!gDatGralOpe) throw new Error("gDatGralOpe no encontrado");
  const fecha_emision_de = textOf(firstNs(gDatGralOpe, "dFeEmiDE"));

  const gEmis = firstNs(gDatGralOpe, "gEmis");
  if (!gEmis) throw new Error("gEmis no encontrado");
  const gActEco = firstNs(gEmis, "gActEco");
  const cActEco = gActEco ? textOf(firstNs(gActEco, "cActEco")) : "";
  const dDesActEco = gActEco ? textOf(firstNs(gActEco, "dDesActEco")) : "";

  const gTimb = firstNs(de, "gTimb");
  if (!gTimb) throw new Error("gTimb no encontrado");
  const iTiDE = textOf(firstNs(gTimb, "iTiDE"));
  const timbrado = {
    dNumTim: textOf(firstNs(gTimb, "dNumTim")),
    dEst: textOf(firstNs(gTimb, "dEst")),
    dPunExp: textOf(firstNs(gTimb, "dPunExp")),
    dNumDoc: textOf(firstNs(gTimb, "dNumDoc")),
    dFeIniT: textOf(firstNs(gTimb, "dFeIniT")),
  };

  return {
    cdcId,
    iTiDE,
    timbrado,
    actividad: { cActEco, dDesActEco },
    emisor: {
      dRucEm: textOf(firstNs(gEmis, "dRucEm")),
      dDVEmi: textOf(firstNs(gEmis, "dDVEmi")),
    },
    fecha_emision_de,
  };
}

export function parseKudeFromSignedRdeXml(xmlUtf8: string): KudeParsedFromXml {
  const doc = new DOMParser().parseFromString(xmlUtf8, "application/xml");
  const parseErr = doc.getElementsByTagName("parsererror")[0];
  if (parseErr) throw new Error("XML inválido (parsererror)");

  const rde = parseRdeRoot(doc);
  const de = firstNs(rde, "DE");
  if (!de) throw new Error("DE no encontrado");

  const idDe = de.getAttribute("Id")?.trim();
  if (!idDe) throw new Error("DE sin atributo Id (CDC)");
  const cdc = idDe;

  const gCamFuFD = firstNs(rde, "gCamFuFD");
  const dCarEl = gCamFuFD ? firstNs(gCamFuFD, "dCarQR") : undefined;
  const dCarQR = dCarEl ? textOf(dCarEl) : null;

  const gDatGralOpe = firstNs(de, "gDatGralOpe");
  if (!gDatGralOpe) throw new Error("gDatGralOpe no encontrado");
  const dFeEmiDE = textOf(firstNs(gDatGralOpe, "dFeEmiDE"));

  const gOpeCom = firstNs(gDatGralOpe, "gOpeCom");
  const monedaCodigo = gOpeCom ? textOf(firstNs(gOpeCom, "cMoneOpe")) || "PYG" : "PYG";
  const monedaDescripcion = gOpeCom ? textOf(firstNs(gOpeCom, "dDesMoneOpe")) : "";
  const tipoOperacion = gOpeCom ? textOf(firstNs(gOpeCom, "dDesTipTra")) : "";

  const gEmis = firstNs(gDatGralOpe, "gEmis");
  if (!gEmis) throw new Error("gEmis no encontrado");
  const emisor = {
    dRucEm: textOf(firstNs(gEmis, "dRucEm")),
    dDVEmi: textOf(firstNs(gEmis, "dDVEmi")),
    dNomEmi: textOf(firstNs(gEmis, "dNomEmi")),
    dDirEmi: textOf(firstNs(gEmis, "dDirEmi")),
    dTelEmi: textOf(firstNs(gEmis, "dTelEmi")),
    dEmailE: textOf(firstNs(gEmis, "dEmailE")),
  };

  const gDatRec = firstNs(gDatGralOpe, "gDatRec");
  if (!gDatRec) throw new Error("gDatRec no encontrado");
  const iNatRec = textOf(firstNs(gDatRec, "iNatRec"));
  let docLabel = "";
  let docValue = "";
  if (iNatRec === "1") {
    docLabel = "RUC";
    const ruc = textOf(firstNs(gDatRec, "dRucRec"));
    const dv = textOf(firstNs(gDatRec, "dDVRec"));
    docValue = dv ? `${ruc}-${dv}` : ruc;
  } else {
    docLabel = textOf(firstNs(gDatRec, "dDTipIDRec")) || "Documento";
    docValue = textOf(firstNs(gDatRec, "dNumIDRec"));
  }
  const receptor = {
    nombre: textOf(firstNs(gDatRec, "dNomRec")),
    docLabel,
    docValue,
    direccion: textOf(firstNs(gDatRec, "dDirRec")),
    telefono: textOf(firstNs(gDatRec, "dTelRec")),
  };

  const gTimb = firstNs(de, "gTimb");
  if (!gTimb) throw new Error("gTimb no encontrado");
  const timbrado = {
    dNumTim: textOf(firstNs(gTimb, "dNumTim")),
    dEst: textOf(firstNs(gTimb, "dEst")),
    dPunExp: textOf(firstNs(gTimb, "dPunExp")),
    dNumDoc: textOf(firstNs(gTimb, "dNumDoc")),
    dFeIniT: textOf(firstNs(gTimb, "dFeIniT")),
  };

  const gTotSub = firstNs(de, "gTotSub");
  if (!gTotSub) throw new Error("gTotSub no encontrado");

  const dIVA5raw = tagTextOrZero(gTotSub, "dIVA5");
  const dIVA10raw = tagTextOrZero(gTotSub, "dIVA10");
  const dTotIVAraw = textOf(firstNs(gTotSub, "dTotIVA"));
  const dTotIVAResuelto = resolverDTotIva(dTotIVAraw === "" ? "0" : dTotIVAraw, dIVA5raw, dIVA10raw);

  const dBaseGrav5 = textOf(firstNs(gTotSub, "dBaseGrav5"));
  const dBaseGrav10 = textOf(firstNs(gTotSub, "dBaseGrav10"));
  let dTBasGraIVA = textOf(firstNs(gTotSub, "dTBasGraIVA"));
  if (dTBasGraIVA === "") {
    const b5 = parseNumLoose(dBaseGrav5 || "0");
    const b10 = parseNumLoose(dBaseGrav10 || "0");
    const sum = b5 + b10;
    dTBasGraIVA = sum > 0 ? String(Math.round(sum)) : "0";
  }

  const totales = {
    dSubExe: tagTextOrZero(gTotSub, "dSubExe"),
    dSub5: tagTextOrZero(gTotSub, "dSub5"),
    dSub10: tagTextOrZero(gTotSub, "dSub10"),
    dTotOpe: tagTextOrZero(gTotSub, "dTotOpe"),
    dTotGralOpe: tagTextOrZero(gTotSub, "dTotGralOpe"),
    dIVA5: dIVA5raw,
    dIVA10: dIVA10raw,
    dBaseGrav5: dBaseGrav5 === "" ? "0" : dBaseGrav5,
    dBaseGrav10: dBaseGrav10 === "" ? "0" : dBaseGrav10,
    dTBasGraIVA,
    dTotIVA: dTotIVAResuelto,
  };

  const gDtipDE = firstNs(de, "gDtipDE");
  let condicionVenta = "";
  if (gDtipDE) {
    const gCamCond = firstNs(gDtipDE, "gCamCond");
    if (gCamCond) {
      condicionVenta = textOf(firstNs(gCamCond, "dDCondOpe"));
    }
  }

  const items: KudeItemRow[] = [];
  let sumLiqIva5 = 0;
  let sumLiqIva10 = 0;
  if (gDtipDE) {
    const nodes = gDtipDE.getElementsByTagNameNS(NS, "gCamItem");
    for (let i = 0; i < nodes.length; i++) {
      const it = nodes[i] as XmlElement;
      const codigo = textOf(firstNs(it, "dCodInt"));
      const descripcion = textOf(firstNs(it, "dDesProSer"));
      const unidadMedida = textOf(firstNs(it, "dDesUniMed"));
      const cantidad = textOf(firstNs(it, "dCantProSer"));
      const gVi = firstNs(it, "gValorItem");
      const precioUnit = textOf(firstNs(gVi ?? it, "dPUniProSer"));
      const gVr = gVi ? firstNs(gVi, "gValorRestaItem") : undefined;
      const totalLinea = textOf(firstNs(gVr ?? gVi ?? it, "dTotOpeItem"));
      const gIva = firstNs(it, "gCamIVA");
      const cols = columnasMontosPorItem(totalLinea, gIva);
      if (gIva) {
        const liq = parseNumLoose(textOf(firstNs(gIva, "dLiqIVAItem")));
        const tasa = parseNumLoose(textOf(firstNs(gIva, "dTasaIVA")));
        if (liq > 0) {
          if (Math.abs(tasa - 5) < 0.6) sumLiqIva5 += liq;
          else if (Math.abs(tasa - 10) < 0.6 || tasa >= 9) sumLiqIva10 += liq;
        }
      }
      items.push({
        codigo: codigo || `L${i + 1}`,
        descripcion,
        unidadMedida: unidadMedida || "—",
        cantidad,
        precioUnit,
        totalLinea,
        montoExenta: cols.exenta,
        montoGrav5: cols.g5,
        montoGrav10: cols.g10,
      });
    }
  }

  const baseParsed: KudeParsedFromXml = {
    cdc,
    dFeEmiDE,
    dCarQR: dCarQR && dCarQR.length > 0 ? dCarQR : null,
    monedaCodigo,
    monedaDescripcion,
    timbrado,
    emisor,
    receptor,
    operacion: {
      condicionVenta: condicionVenta || "—",
      tipoOperacion: tipoOperacion || "—",
    },
    totales,
    items,
  };

  return reconcileKudeFiscalDisplay(baseParsed, sumLiqIva5, sumLiqIva10);
}

/**
 * Alinea totales e ítems del KuDE cuando el XML trae IVA/base mal o ítems marcados como exentos
 * pero `gTotSub` indica gravado (p. ej. dSub10 / dBaseGrav10). No modifica el XML firmado.
 */
function reconcileKudeFiscalDisplay(
  p: KudeParsedFromXml,
  sumLiqIva5: number,
  sumLiqIva10: number
): KudeParsedFromXml {
  const tot = { ...p.totales };
  const items = p.items.map((i) => ({ ...i }));

  let iv5 = parseNumLoose(tot.dIVA5);
  let iv10 = parseNumLoose(tot.dIVA10);
  if (iv10 <= 0 && sumLiqIva10 > 0.25) {
    iv10 = Math.round(sumLiqIva10);
  }
  if (iv5 <= 0 && sumLiqIva5 > 0.25) {
    iv5 = Math.round(sumLiqIva5);
  }

  let b5 = parseNumLoose(tot.dBaseGrav5);
  let b10 = parseNumLoose(tot.dBaseGrav10);
  let sub5 = parseNumLoose(tot.dSub5);
  let sub10 = parseNumLoose(tot.dSub10);

  if (sub10 <= 0 && sumLiqIva10 > 0.25) {
    iv10 = Math.round(sumLiqIva10);
    b10 = Math.round(iv10 * 10);
    sub10 = b10 + iv10;
    tot.dSub10 = String(sub10);
  }
  if (sub5 <= 0 && sumLiqIva5 > 0.25) {
    iv5 = Math.round(sumLiqIva5);
    b5 = Math.round(iv5 * 20);
    sub5 = b5 + iv5;
    tot.dSub5 = String(sub5);
  }

  if (sub10 > 0) {
    if (b10 <= 0) {
      b10 = Math.round(sub10 / 1.1);
      if (iv10 <= 0) {
        iv10 = Math.max(0, sub10 - b10);
      }
    } else if (iv10 <= 0) {
      iv10 = Math.max(0, Math.round(sub10 - b10));
    }
  }

  if (sub5 > 0) {
    if (b5 <= 0) {
      b5 = Math.round(sub5 / 1.05);
      if (iv5 <= 0) {
        iv5 = Math.max(0, sub5 - b5);
      }
    } else if (iv5 <= 0) {
      iv5 = Math.max(0, Math.round(sub5 - b5));
    }
  }

  tot.dIVA5 = String(Math.round(iv5));
  tot.dIVA10 = String(Math.round(iv10));
  tot.dBaseGrav5 = String(Math.round(b5));
  tot.dBaseGrav10 = String(Math.round(b10));
  tot.dTBasGraIVA = String(Math.round(b5 + b10));
  tot.dTotIVA = String(Math.round(iv5 + iv10));

  const sumG10 = items.reduce((s, i) => s + parseNumLoose(i.montoGrav10), 0);
  const sumG5 = items.reduce((s, i) => s + parseNumLoose(i.montoGrav5), 0);
  const sumEx = items.reduce((s, i) => s + parseNumLoose(i.montoExenta), 0);

  if (sub10 > 0.5 && sumG10 < 1 && sumEx > sub10 * 0.85) {
    if (items.length === 1) {
      const it = items[0]!;
      items[0] = { ...it, montoExenta: "0", montoGrav10: it.totalLinea };
    } else {
      const exTotal = sumEx;
      for (let i = 0; i < items.length; i++) {
        const it = items[i]!;
        const ex = parseNumLoose(it.montoExenta);
        if (ex <= 0) continue;
        const share = exTotal > 0 ? (sub10 * ex) / exTotal : 0;
        items[i] = { ...it, montoExenta: "0", montoGrav10: String(Math.round(share)) };
      }
    }
  }

  if (sub5 > 0.5 && sumG5 < 1 && sumEx > sub5 * 0.85 && sub10 <= 0) {
    if (items.length === 1) {
      const it = items[0]!;
      items[0] = { ...it, montoExenta: "0", montoGrav5: it.totalLinea };
    }
  }

  const sumLine10 = items.reduce((s, i) => s + parseNumLoose(i.montoGrav10), 0);
  const sumLine5 = items.reduce((s, i) => s + parseNumLoose(i.montoGrav5), 0);
  let sub10n = parseNumLoose(tot.dSub10);
  let sub5n = parseNumLoose(tot.dSub5);
  iv10 = parseNumLoose(tot.dIVA10);
  iv5 = parseNumLoose(tot.dIVA5);
  b10 = parseNumLoose(tot.dBaseGrav10);
  b5 = parseNumLoose(tot.dBaseGrav5);

  if (sub10n <= 0 && sumLine10 > 0.5) {
    sub10n = Math.round(sumLine10);
    tot.dSub10 = String(sub10n);
    if (b10 <= 0) {
      b10 = Math.round(sub10n / 1.1);
      if (iv10 <= 0) iv10 = Math.max(0, sub10n - b10);
    } else if (iv10 <= 0) {
      iv10 = Math.max(0, Math.round(sub10n - b10));
    }
    tot.dBaseGrav10 = String(Math.round(b10));
    tot.dIVA10 = String(Math.round(iv10));
    tot.dTBasGraIVA = String(Math.round(b5 + b10));
    tot.dTotIVA = String(Math.round(iv5 + iv10));
  }

  if (sub5n <= 0 && sumLine5 > 0.5) {
    sub5n = Math.round(sumLine5);
    tot.dSub5 = String(sub5n);
    if (b5 <= 0) {
      b5 = Math.round(sub5n / 1.05);
      if (iv5 <= 0) iv5 = Math.max(0, sub5n - b5);
    } else if (iv5 <= 0) {
      iv5 = Math.max(0, Math.round(sub5n - b5));
    }
    tot.dBaseGrav5 = String(Math.round(b5));
    tot.dIVA5 = String(Math.round(iv5));
    tot.dTBasGraIVA = String(Math.round(b5 + b10));
    tot.dTotIVA = String(Math.round(iv5 + iv10));
  }

  return { ...p, totales: tot, items };
}

export function kudeFallbackQrUrl(cdc: string): string {
  const id = encodeURIComponent(cdc);
  return `https://ekuatia.set.gov.py/consultas/qr?nVersion=150&id=${id}`;
}
