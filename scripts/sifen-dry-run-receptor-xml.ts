/**
 * Dry-run local (sin SET, sin firma): valida ramas gDatRec del XML SIFEN v150.
 * Ejecutar: npx tsx scripts/sifen-dry-run-receptor-xml.ts
 */
import type { SifenFacturaPayloadBase } from "../src/lib/sifen/types";
import { buildOfficialRdeFacturaElectronicaXml } from "../src/lib/sifen/rde-xml";

const emisorBase = {
  ruc: "4192083-5",
  razon_social: "Emisor Prueba SRL",
  direccion_fiscal: "Av. Dry Run 1000 (no es razón social)",
  timbrado_numero: "12345678",
  timbrado_fecha_inicio_vigencia: "2026-01-01",
  actividad_economica_codigo: "47111",
  actividad_economica_descripcion: "Comercio minorista",
  establecimiento: "001",
  punto_expedicion: "001",
  csc: null,
} as const;

const documentoBase = {
  factura_id: "00000000-0000-4000-8000-0000000000aa",
  numero_factura: "FAC-000002",
  fecha: "2026-05-13",
  tipo: "venta",
  moneda: "GS",
  monto: 1100,
  saldo: 0,
} as const;

const items = [
  {
    descripcion: "Servicio de prueba",
    cantidad: 1,
    precio_unitario: 1000,
    subtotal: 1000,
    iva: 100,
    total: 1100,
  },
];

const xmlOpts = {
  timbradoFechaInicio: "2026-01-01",
  ambiente: "test" as const,
  emisorTelefono: "0210000000",
  emisorEmail: "dry-run@example.com.py",
  emisorDireccion: emisorBase.direccion_fiscal,
  emisorNumCasa: 1,
  actividadEconomicaCodigo: emisorBase.actividad_economica_codigo,
  actividadEconomicaDescripcion: emisorBase.actividad_economica_descripcion,
};

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function extractGDatRec(xml: string): string {
  const a = xml.indexOf("<gDatRec>");
  const b = xml.indexOf("</gDatRec>");
  assert(a >= 0 && b > a, "No se encontró gDatRec en el XML");
  return xml.slice(a, b + "</gDatRec>".length);
}

function extractCdc(xml: string): string {
  const m = /\bId="(\d{44})"/.exec(xml);
  assert(m != null, "No se encontró CDC (Id) en el XML");
  return m[1]!;
}

function runCase(name: string, receptor: SifenFacturaPayloadBase["receptor"], checks: { mustHave?: string[]; mustNot?: string[] }) {
  const base: SifenFacturaPayloadBase = {
    emisor: { ...emisorBase },
    documento: { ...documentoBase },
    receptor,
    items,
    sifen: {
      factura_electronica_id: "00000000-0000-4000-8000-0000000000bb",
      estado_sifen: "borrador",
    },
  };
  const xml = buildOfficialRdeFacturaElectronicaXml(base, xmlOpts);
  const bloque = extractGDatRec(xml);
  for (const s of checks.mustHave ?? []) {
    assert(bloque.includes(s), `${name}: debe contener ${s}`);
  }
  for (const s of checks.mustNot ?? []) {
    assert(!bloque.includes(s), `${name}: no debe contener ${s}`);
  }
  console.log(`OK: ${name}`);
}

runCase(
  "receptor paraguayo con RUC (dRucRec/dDVRec, iTiOpe B2B)",
  {
    cliente_id: "00000000-0000-4000-8000-000000000001",
    nombre: "Cliente Local SA",
    ruc: "4192083-5",
    documento: null,
    direccion: null,
    telefono: null,
    email: null,
    receptor_extranjero: false,
  },
  {
    mustHave: ["<dRucRec>", "<dDVRec>", "<cPaisRec>PRY</cPaisRec>", "<iNatRec>1</iNatRec>", "<iTiOpe>1</iTiOpe>"],
    mustNot: ["<dNumIDRec>", "<iTiOpe>4</iTiOpe>"],
  }
);

runCase(
  "receptor paraguayo solo CI (sin dRucRec; iTiOpe B2B)",
  {
    cliente_id: "00000000-0000-4000-8000-000000000002",
    nombre: "Persona Natural",
    ruc: null,
    documento: "1234567",
    direccion: null,
    telefono: null,
    email: null,
    receptor_extranjero: false,
  },
  {
    mustHave: ["<dNumIDRec>1234567</dNumIDRec>", "<cPaisRec>PRY</cPaisRec>", "<iNatRec>2</iNatRec>", "<iTiOpe>1</iTiOpe>"],
    mustNot: ["<dRucRec>", "<iTiOpe>4</iTiOpe>"],
  }
);

runCase(
  "receptor extranjero (iNatRec 2, iTiOpe B2F=4, sin dRucRec)",
  {
    cliente_id: "00000000-0000-4000-8000-000000000003",
    nombre: "Cliente extranjero de prueba",
    ruc: "20603666098",
    documento: "20603666098",
    direccion: null,
    telefono: null,
    email: null,
    receptor_extranjero: true,
    codigo_pais_iso3: "PER",
    tipo_doc_receptor: 9,
    num_id_receptor: "20603666098",
  },
  {
    mustHave: [
      "<cPaisRec>PER</cPaisRec>",
      "<dNumIDRec>20603666098</dNumIDRec>",
      "<iTipIDRec>9</iTipIDRec>",
      "<iNatRec>2</iNatRec>",
      "<iTiOpe>4</iTiOpe>",
    ],
    mustNot: ["<dRucRec>", "<dDVRec>", "<iTiOpe>1</iTiOpe>"],
  }
);

runCase(
  "receptor manual extranjero (iTiOpe B2G explícito, dirección y casa)",
  {
    cliente_id: "00000000-0000-4000-8000-0000000000cc",
    nombre: "Receptor exterior de prueba",
    documento: "20603666098",
    ruc: null,
    direccion: null,
    telefono: null,
    email: null,
    receptor_extranjero: true,
    codigo_pais_iso3: "PER",
    tipo_doc_receptor: 9,
    num_id_receptor: "20603666098",
    sifen_receptor_config_manual: true,
    sifen_i_nat_rec: 2,
    sifen_i_ti_ope: 3,
    sifen_d_dir_rec: "CALLE COMERCIO EXTERIOR 1000",
    sifen_d_num_cas_rec: 0,
  },
  {
    mustHave: [
      "<iNatRec>2</iNatRec>",
      "<iTiOpe>3</iTiOpe>",
      "<cPaisRec>PER</cPaisRec>",
      "<dDirRec>CALLE COMERCIO EXTERIOR 1000</dDirRec>",
      "<dNumCasRec>0</dNumCasRec>",
      "<dNumIDRec>20603666098</dNumIDRec>",
    ],
    mustNot: ["<dRucRec>", "<dDVRec>"],
  }
);

const feId = "00000000-0000-4000-8000-0000000000bb";
const xml0 = buildOfficialRdeFacturaElectronicaXml(
  {
    emisor: { ...emisorBase },
    documento: { ...documentoBase },
    receptor: {
      cliente_id: "00000000-0000-4000-8000-000000000003",
      nombre: "Cliente extranjero de prueba",
      ruc: "20603666098",
      documento: "20603666098",
      direccion: null,
      telefono: null,
      email: null,
      receptor_extranjero: true,
      codigo_pais_iso3: "PER",
      tipo_doc_receptor: 9,
      num_id_receptor: "20603666098",
    },
    items,
    sifen: { factura_electronica_id: feId, estado_sifen: "borrador" },
  },
  xmlOpts
);
const xml1 = buildOfficialRdeFacturaElectronicaXml(
  {
    emisor: { ...emisorBase },
    documento: { ...documentoBase },
    receptor: {
      cliente_id: "00000000-0000-4000-8000-000000000003",
      nombre: "Cliente extranjero de prueba",
      ruc: "20603666098",
      documento: "20603666098",
      direccion: null,
      telefono: null,
      email: null,
      receptor_extranjero: true,
      codigo_pais_iso3: "PER",
      tipo_doc_receptor: 9,
      num_id_receptor: "20603666098",
    },
    items,
    sifen: { factura_electronica_id: feId, estado_sifen: "rechazado", sifen_regeneracion_seq: 1 },
  },
  xmlOpts
);
assert(extractCdc(xml0) !== extractCdc(xml1), "CDC debe cambiar cuando sifen_regeneracion_seq > 0 (misma factura electrónica)");
console.log("OK: CDC distinto con sifen_regeneracion_seq=1 vs sin secuencia");

console.log("\nDry-run receptor SIFEN: todas las comprobaciones pasaron (sin envío a SET).");
