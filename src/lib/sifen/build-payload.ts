import type {
  EstadoSifen,
  SifenFacturaPayloadBase,
  SifenPayloadDocumento,
  SifenPayloadEmisor,
  SifenPayloadItem,
  SifenPayloadMeta,
  SifenPayloadReceptor,
} from "./types";
import { normalizeActividadEconomica, normalizeTimbradoFechaInicioVigencia } from "./config-validation";
import { splitRucParaXml } from "./sifen-cdc";
import {
  normalizarTipoDocReceptorSifen,
  resolveCodigoPaisIso3Receptor,
} from "./sifen-receptor-pais";
import {
  clienteUsaReceptorSifenManual,
  validateReceptorExplicitManual,
} from "./sifen-receptor-manual-validate";

function trimStr(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

/** Normaliza para comparar dirección vs nombre/razón social (evitar dDirRec = nombre). */
function normKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export interface SifenBuildFacturaRow {
  id: string;
  cliente_id: string;
  numero_factura: string;
  fecha: string;
  tipo: string;
  moneda: string;
  monto: unknown;
  saldo: unknown;
}

export interface SifenBuildItemRow {
  descripcion: string;
  cantidad: unknown;
  precio_unitario: unknown;
  subtotal: unknown;
  iva: unknown;
  total: unknown;
}

export interface SifenBuildClienteRow {
  id: string;
  empresa: string | null;
  nombre_contacto: string | null;
  nombre: string | null;
  ruc: string | null;
  documento: string | null;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
  pais?: string | null;
  sifen_receptor_extranjero?: boolean | null;
  sifen_codigo_pais?: string | null;
  sifen_tipo_doc_receptor?: number | string | null;
  /** Si true, el DE usa columnas explícitas SIFEN del receptor (ver sifen_receptor_naturaleza, sifen_ti_ope, etc.). */
  sifen_receptor_manual?: boolean | null;
  sifen_receptor_naturaleza?: string | null;
  sifen_ti_ope?: number | string | null;
  sifen_num_id_de?: string | null;
  sifen_direccion_de?: string | null;
  sifen_num_casa_de?: number | string | null;
  sifen_descripcion_tipo_doc?: string | null;
}

export interface SifenBuildConfigRow {
  ruc: string;
  razon_social: string;
  direccion_fiscal: string | null;
  timbrado_numero: string;
  timbrado_fecha_inicio_vigencia?: string | null;
  actividad_economica_codigo?: string | null;
  actividad_economica_descripcion?: string | null;
  establecimiento: string;
  punto_expedicion: string;
  csc: string | null;
  activo: boolean;
}

export interface SifenBuildElectronicaRow {
  id: string;
  estado_sifen: EstadoSifen;
  sifen_regeneracion_seq?: number | null;
}

export interface BuildSifenPayloadInput {
  factura: SifenBuildFacturaRow;
  items: SifenBuildItemRow[];
  cliente: SifenBuildClienteRow | null;
  config: SifenBuildConfigRow | null;
  facturaElectronica: SifenBuildElectronicaRow | null;
}

export type BuildSifenPayloadResult =
  | { ok: true; payload: SifenFacturaPayloadBase }
  | { ok: false; error: string };

function nombreReceptor(c: SifenBuildClienteRow): string {
  return trimStr(c.empresa) || trimStr(c.nombre_contacto) || trimStr(c.nombre);
}

function validateEmisor(config: SifenBuildConfigRow | null): { ok: true; emisor: SifenPayloadEmisor } | { ok: false; error: string } {
  if (!config) {
    return {
      ok: false,
      error:
        "No hay configuración SIFEN para esta empresa. Cree la configuración en /api/configuracion/sifen.",
    };
  }
  if (!config.activo) {
    return {
      ok: false,
      error:
        "La configuración SIFEN está desactivada. Actívela en /api/configuracion/sifen antes de obtener el payload.",
    };
  }
  const ruc = trimStr(config.ruc);
  const razon_social = trimStr(config.razon_social);
  const timbrado_numero = trimStr(config.timbrado_numero);
  const establecimiento = trimStr(config.establecimiento);
  const punto_expedicion = trimStr(config.punto_expedicion);
  const direccion_fiscal = trimStr(config.direccion_fiscal);
  const faltas: string[] = [];
  if (!ruc) faltas.push("empresa_sifen_config.ruc");
  if (!razon_social) faltas.push("empresa_sifen_config.razon_social");
  if (!direccion_fiscal) faltas.push("empresa_sifen_config.direccion_fiscal");
  if (!timbrado_numero) faltas.push("empresa_sifen_config.timbrado_numero");
  if (!establecimiento) faltas.push("empresa_sifen_config.establecimiento");
  if (!punto_expedicion) faltas.push("empresa_sifen_config.punto_expedicion");
  if (faltas.length > 0) {
    return {
      ok: false,
      error: `Faltan datos del emisor en configuración SIFEN: ${faltas.join(", ")}.`,
    };
  }
  if (normKey(direccion_fiscal) === normKey(razon_social)) {
    return {
      ok: false,
      error:
        "direccion_fiscal no puede ser igual a la razón social: indique la calle o domicilio fiscal del emisor en configuración SIFEN (campo dirección fiscal).",
    };
  }
  const cscRaw = config.csc == null ? "" : trimStr(config.csc);
  const tin = normalizeTimbradoFechaInicioVigencia(config.timbrado_fecha_inicio_vigencia);
  if (!tin.ok) {
    return {
      ok: false,
      error: `Configuración SIFEN: ${tin.error} Configuración → Facturación electrónica.`,
    };
  }
  const act = normalizeActividadEconomica(
    config.actividad_economica_codigo,
    config.actividad_economica_descripcion
  );
  if (!act.ok) {
    return {
      ok: false,
      error: `Configuración SIFEN: ${act.error} Configuración → Facturación electrónica.`,
    };
  }
  return {
    ok: true,
    emisor: {
      ruc,
      razon_social,
      direccion_fiscal,
      timbrado_numero,
      timbrado_fecha_inicio_vigencia: tin.value,
      actividad_economica_codigo: act.codigo,
      actividad_economica_descripcion: act.descripcion,
      establecimiento,
      punto_expedicion,
      csc: cscRaw === "" ? null : cscRaw,
    },
  };
}

function parseBoolCliente(v: unknown): boolean {
  if (v === true) return true;
  if (v === false || v == null) return false;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "1" || s === "t" || s === "yes" || s === "si" || s === "sí";
  }
  return Boolean(v);
}

function validateReceptor(
  factura: SifenBuildFacturaRow,
  cliente: SifenBuildClienteRow | null
): { ok: true; receptor: SifenPayloadReceptor } | { ok: false; error: string } {
  if (!cliente) {
    return {
      ok: false,
      error: "No se encontró el cliente asociado a la factura (cliente_id inválido o sin acceso).",
    };
  }
  if (trimStr(cliente.id) !== trimStr(factura.cliente_id)) {
    return { ok: false, error: "El cliente cargado no coincide con cliente_id de la factura." };
  }
  if (clienteUsaReceptorSifenManual(cliente)) {
    return validateReceptorExplicitManual(cliente, factura.cliente_id);
  }
  const nombre = nombreReceptor(cliente);
  if (!nombre) {
    return {
      ok: false,
      error:
        "Falta el nombre del receptor: complete en el cliente al menos uno de: empresa, nombre_contacto o nombre.",
    };
  }
  const extranjero = parseBoolCliente(cliente.sifen_receptor_extranjero);
  const ruc = trimStr(cliente.ruc) || null;
  const documento = trimStr(cliente.documento) || null;
  const paisTxt = trimStr(cliente.pais) || null;

  const dirRaw = trimStr(cliente.direccion);
  let direccion: string | null = dirRaw || null;
  if (direccion) {
    const hints = [
      trimStr(cliente.empresa),
      trimStr(cliente.nombre_contacto),
      trimStr(cliente.nombre),
      nombre,
    ].filter((h) => h.length > 0);
    const nDir = normKey(direccion);
    if (hints.some((h) => normKey(h) === nDir)) {
      direccion = null;
    }
  }

  if (extranjero) {
    const codigoPais = resolveCodigoPaisIso3Receptor({
      sifenCodigoPais: cliente.sifen_codigo_pais,
      paisTexto: paisTxt,
    });
    if (!codigoPais) {
      return {
        ok: false,
        error:
          "Receptor extranjero SIFEN: indique `sifen_codigo_pais` (ISO3, ej. PER) o un país reconocible en el campo país del cliente.",
      };
    }
    if (codigoPais === "PRY") {
      return {
        ok: false,
        error:
          "Receptor extranjero SIFEN: el código país no puede ser PRY. Desactive receptor extranjero si el cliente es contribuyente paraguayo.",
      };
    }
    const numFuente = documento || ruc;
    if (!numFuente) {
      return {
        ok: false,
        error:
          "Receptor extranjero SIFEN: complete `documento` o `ruc` con el número de identificación tributaria del exterior.",
      };
    }
    const num_id_receptor = numFuente.replace(/\s/g, "").slice(0, 20);
    if (!num_id_receptor) {
      return {
        ok: false,
        error: "Receptor extranjero SIFEN: el número de identificación quedó vacío tras normalizar.",
      };
    }
    const tipoDb = normalizarTipoDocReceptorSifen(cliente.sifen_tipo_doc_receptor);
    const tipo_doc_receptor = tipoDb ?? 9;

    const receptor: SifenPayloadReceptor = {
      cliente_id: cliente.id,
      nombre,
      documento,
      ruc,
      direccion,
      telefono: trimStr(cliente.telefono) || null,
      email: trimStr(cliente.email) || null,
      receptor_extranjero: true,
      codigo_pais_iso3: codigoPais,
      tipo_doc_receptor,
      descripcion_tipo_doc_receptor: null,
      num_id_receptor,
    };
    return { ok: true, receptor };
  }

  if (!ruc && !documento) {
    return {
      ok: false,
      error:
        "Falta identificación del receptor: complete en el cliente al menos ruc o documento.",
    };
  }

  if (ruc) {
    const digitos = ruc.replace(/\D/g, "");
    const nP = normKey(paisTxt || "");
    const textoPareceParaguay =
      !nP || nP.includes("PARAGUAY") || nP === "PY" || nP === "PRY";
    if (textoPareceParaguay && digitos.length >= 10) {
      return {
        ok: false,
        error:
          "Identificación con demasiados dígitos para tratarse como RUC paraguayo con país Paraguay. Si es un documento del exterior (p. ej. RUC de 11 dígitos), active «receptor extranjero SIFEN», asigne país/código ISO3 (ej. PER) y vuelva a intentar.",
      };
    }
  }

  if (ruc) {
    try {
      splitRucParaXml(ruc);
    } catch {
      return {
        ok: false,
        error:
          "El RUC del cliente no es válido como RUC paraguayo SIFEN (longitud o formato). Si es identificación del exterior, active «receptor extranjero SIFEN», indique código país ISO3 (ej. PER) y use documento o RUC con ese número.",
      };
    }
  }

  const receptor: SifenPayloadReceptor = {
    cliente_id: cliente.id,
    nombre,
    documento,
    ruc,
    direccion,
    telefono: trimStr(cliente.telefono) || null,
    email: trimStr(cliente.email) || null,
    receptor_extranjero: false,
  };
  return { ok: true, receptor };
}

function mapItems(rows: SifenBuildItemRow[]): SifenPayloadItem[] {
  return rows.map((r) => ({
    descripcion: trimStr(r.descripcion) || "(sin descripción)",
    cantidad: num(r.cantidad),
    precio_unitario: num(r.precio_unitario),
    subtotal: num(r.subtotal),
    iva: num(r.iva),
    total: num(r.total),
  }));
}

/**
 * Valida datos mínimos y arma el payload base SIFEN (sin XML).
 */
export function validateAndBuildSifenPayload(input: BuildSifenPayloadInput): BuildSifenPayloadResult {
  const { factura, items, cliente, config, facturaElectronica } = input;

  if (!facturaElectronica) {
    return {
      ok: false,
      error:
        "No existe borrador electrónico para esta factura. Genérelo primero con POST /api/facturas/{id}/sifen/borrador.",
    };
  }

  const em = validateEmisor(config);
  if (!em.ok) return em;

  const rec = validateReceptor(factura, cliente);
  if (!rec.ok) return rec;

  if (!items.length) {
    return {
      ok: false,
      error:
        "La factura no tiene líneas en factura_items. Agregue ítems antes de construir el payload SIFEN.",
    };
  }

  const documento: SifenPayloadDocumento = {
    factura_id: factura.id,
    numero_factura: trimStr(factura.numero_factura),
    fecha: trimStr(factura.fecha),
    tipo: trimStr(factura.tipo),
    moneda: trimStr(factura.moneda) || "GS",
    monto: num(factura.monto),
    saldo: num(factura.saldo),
  };

  if (!documento.numero_factura) {
    return { ok: false, error: "La factura no tiene numero_factura." };
  }
  if (!documento.fecha) {
    return { ok: false, error: "La factura no tiene fecha." };
  }
  if (!documento.tipo) {
    return { ok: false, error: "La factura no tiene tipo." };
  }

  const rawSeq = facturaElectronica.sifen_regeneracion_seq;
  const regSeq = Number.isFinite(Number(rawSeq)) ? Math.max(0, Math.floor(Number(rawSeq))) : 0;
  const sifen: SifenPayloadMeta = {
    factura_electronica_id: facturaElectronica.id,
    estado_sifen: facturaElectronica.estado_sifen,
    ...(regSeq > 0 ? { sifen_regeneracion_seq: regSeq } : {}),
  };

  const payload: SifenFacturaPayloadBase = {
    emisor: em.emisor,
    documento,
    receptor: rec.receptor,
    items: mapItems(items),
    sifen,
  };

  return { ok: true, payload };
}
