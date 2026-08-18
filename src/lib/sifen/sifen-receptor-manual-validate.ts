/**
 * Validación de receptor SIFEN con configuración manual por cliente (estilo e-Kuatia’i).
 * No importa `build-payload` para evitar ciclos de dependencias.
 */
import { splitRucParaXml } from "./sifen-cdc";
import {
  assertCoherenciaTiOpePais,
  descripcionTipoDocRecepXml,
  normalizarTipoDocReceptorSifen,
  resolveCodigoPaisIso3Receptor,
} from "./sifen-receptor-pais";
import type { SifenPayloadReceptor } from "./types";

function trimStr(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
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

function normKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export type SifenReceptorNaturalezaManual = "contribuyente_paraguayo" | "no_contribuyente" | "extranjero";

export interface ClienteSifenManualSource {
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
  sifen_receptor_manual?: boolean | null;
  sifen_receptor_naturaleza?: string | null;
  sifen_ti_ope?: number | string | null;
  sifen_num_id_de?: string | null;
  sifen_direccion_de?: string | null;
  sifen_num_casa_de?: number | string | null;
  sifen_descripcion_tipo_doc?: string | null;
  sifen_codigo_pais?: string | null;
  sifen_tipo_doc_receptor?: number | string | null;
  sifen_receptor_extranjero?: boolean | null;
}

function nombreReceptor(c: ClienteSifenManualSource): string {
  return trimStr(c.empresa) || trimStr(c.nombre_contacto) || trimStr(c.nombre);
}

function direccionDeParaSifen(c: ClienteSifenManualSource, nombre: string): string | null {
  const rawDe = trimStr(c.sifen_direccion_de);
  const rawCli = trimStr(c.direccion);
  const candidato = rawDe || rawCli;
  if (!candidato) return null;
  const hints = [
    trimStr(c.empresa),
    trimStr(c.nombre_contacto),
    trimStr(c.nombre),
    nombre,
  ].filter((h) => h.length > 0);
  const nDir = normKey(candidato);
  if (hints.some((h) => normKey(h) === nDir)) return null;
  return candidato;
}

function numCasaDe(c: ClienteSifenManualSource): number {
  const v = c.sifen_num_casa_de;
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), 999999);
}

/**
 * Construye `SifenPayloadReceptor` cuando `sifen_receptor_manual` está activo en el cliente.
 */
export function validateReceptorExplicitManual(
  cliente: ClienteSifenManualSource,
  facturaClienteId: string
): { ok: true; receptor: SifenPayloadReceptor } | { ok: false; error: string } {
  if (trimStr(cliente.id) !== trimStr(facturaClienteId)) {
    return { ok: false, error: "El cliente cargado no coincide con cliente_id de la factura." };
  }
  const nombre = nombreReceptor(cliente);
  if (!nombre) {
    return {
      ok: false,
      error:
        "Falta el nombre del receptor: complete en el cliente al menos uno de: empresa, nombre_contacto o nombre.",
    };
  }
  let nat = trimStr(cliente.sifen_receptor_naturaleza) as SifenReceptorNaturalezaManual | "";
  /**
   * Auto-promoción a "extranjero" cuando el cliente fue cargado como "no_contribuyente"
   * pero los demás campos indican inequívocamente receptor extranjero (B2F + país no-PRY +
   * flag de extranjero). Evita el bug histórico que generaba B2F+PRY (rechazo SET GENFE025).
   */
  if (nat === "no_contribuyente") {
    const tiRaw = cliente.sifen_ti_ope;
    const tiCheck = typeof tiRaw === "number" ? tiRaw : parseInt(String(tiRaw ?? ""), 10);
    const codigoPaisCheck = resolveCodigoPaisIso3Receptor({
      sifenCodigoPais: cliente.sifen_codigo_pais,
      paisTexto: cliente.pais,
    });
    const extranjeroFlag = parseBoolCliente(cliente.sifen_receptor_extranjero);
    if (tiCheck === 4 && codigoPaisCheck && codigoPaisCheck !== "PRY" && extranjeroFlag) {
      nat = "extranjero";
    }
  }
  if (nat !== "contribuyente_paraguayo" && nat !== "no_contribuyente" && nat !== "extranjero") {
    return {
      ok: false,
      error:
        "SIFEN receptor manual: seleccioná la naturaleza del receptor (contribuyente paraguayo, no contribuyente o extranjero).",
    };
  }
  const tiRaw = cliente.sifen_ti_ope;
  const tiOpe = typeof tiRaw === "number" ? tiRaw : parseInt(String(tiRaw ?? ""), 10);
  if (!Number.isFinite(tiOpe) || tiOpe < 1 || tiOpe > 4) {
    return {
      ok: false,
      error: "SIFEN receptor manual: indicá el tipo de operación (B2B, B2C, B2G o B2F / exterior).",
    };
  }
  const dirSifen = direccionDeParaSifen(cliente, nombre);
  if (!dirSifen) {
    return {
      ok: false,
      error:
        "SIFEN receptor manual: completá la dirección para el DE (campo «Dirección SIFEN» o la dirección del cliente distinta del nombre/razón social).",
    };
  }
  const casa = numCasaDe(cliente);

  const base: Pick<SifenPayloadReceptor, "cliente_id" | "nombre" | "telefono" | "email"> = {
    cliente_id: cliente.id,
    nombre,
    telefono: trimStr(cliente.telefono) || null,
    email: trimStr(cliente.email) || null,
  };

  if (nat === "contribuyente_paraguayo") {
    const ruc = trimStr(cliente.ruc);
    if (!ruc) {
      return { ok: false, error: "SIFEN receptor manual (contribuyente): el RUC del cliente es obligatorio." };
    }
    try {
      splitRucParaXml(ruc);
    } catch {
      return {
        ok: false,
        error:
          "SIFEN receptor manual (contribuyente): el RUC no es válido como RUC paraguayo SIFEN. Corregí el RUC o desactivá el modo manual.",
      };
    }
    try {
      assertCoherenciaTiOpePais(tiOpe, "PRY");
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    return {
      ok: true,
      receptor: {
        ...base,
        documento: trimStr(cliente.documento) || null,
        ruc,
        direccion: trimStr(cliente.direccion) || null,
        receptor_extranjero: false,
        codigo_pais_iso3: "PRY",
        sifen_receptor_config_manual: true,
        sifen_i_nat_rec: 1,
        sifen_i_ti_ope: tiOpe as 1 | 2 | 3 | 4,
        sifen_d_dir_rec: dirSifen,
        sifen_d_num_cas_rec: casa,
      },
    };
  }

  const numFuente =
    trimStr(cliente.sifen_num_id_de) || trimStr(cliente.documento) || trimStr(cliente.ruc) || "";
  const num_id_receptor = numFuente.replace(/\s/g, "").slice(0, 20);
  if (!num_id_receptor) {
    return {
      ok: false,
      error:
        "SIFEN receptor manual: completá el número de documento para el DE (campo «Número documento SIFEN» o documento/RUC del cliente).",
    };
  }

  if (nat === "no_contribuyente") {
    const tipoDb = normalizarTipoDocReceptorSifen(cliente.sifen_tipo_doc_receptor);
    const tipo_doc_receptor = tipoDb ?? 1;
    const descripcion_tipo_doc_receptor =
      tipo_doc_receptor === 9 ? trimStr(cliente.sifen_descripcion_tipo_doc) || null : null;
    try {
      descripcionTipoDocRecepXml(tipo_doc_receptor, descripcion_tipo_doc_receptor);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
    try {
      assertCoherenciaTiOpePais(tiOpe, "PRY");
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    return {
      ok: true,
      receptor: {
        ...base,
        documento: trimStr(cliente.documento) || null,
        ruc: trimStr(cliente.ruc) || null,
        direccion: trimStr(cliente.direccion) || null,
        receptor_extranjero: false,
        codigo_pais_iso3: "PRY",
        tipo_doc_receptor,
        descripcion_tipo_doc_receptor,
        num_id_receptor,
        sifen_receptor_config_manual: true,
        sifen_i_nat_rec: 2,
        sifen_i_ti_ope: tiOpe as 1 | 2 | 3 | 4,
        sifen_d_dir_rec: dirSifen,
        sifen_d_num_cas_rec: casa,
      },
    };
  }

  /* extranjero */
  const codigoPais = resolveCodigoPaisIso3Receptor({
    sifenCodigoPais: cliente.sifen_codigo_pais,
    paisTexto: cliente.pais,
  });
  if (!codigoPais || codigoPais === "PRY") {
    return {
      ok: false,
      error:
        "SIFEN receptor manual (extranjero): indicá `sifen_codigo_pais` ISO3 (ej. PER) distinto de PRY, o un país reconocible en el campo país.",
    };
  }
  const tipoDb = normalizarTipoDocReceptorSifen(cliente.sifen_tipo_doc_receptor);
  const tipo_doc_receptor = tipoDb ?? 9;
  const descripcion_tipo_doc_receptor =
    tipo_doc_receptor === 9 ? trimStr(cliente.sifen_descripcion_tipo_doc) || null : null;
  try {
    descripcionTipoDocRecepXml(tipo_doc_receptor, descripcion_tipo_doc_receptor);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }

  try {
    assertCoherenciaTiOpePais(tiOpe, codigoPais);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return {
    ok: true,
    receptor: {
      ...base,
      documento: trimStr(cliente.documento) || null,
      ruc: trimStr(cliente.ruc) || null,
      direccion: trimStr(cliente.direccion) || null,
      receptor_extranjero: parseBoolCliente(cliente.sifen_receptor_extranjero) || true,
      codigo_pais_iso3: codigoPais,
      tipo_doc_receptor,
      descripcion_tipo_doc_receptor,
      num_id_receptor,
      sifen_receptor_config_manual: true,
      sifen_i_nat_rec: 2,
      sifen_i_ti_ope: tiOpe as 1 | 2 | 3 | 4,
      sifen_d_dir_rec: dirSifen,
      sifen_d_num_cas_rec: casa,
    },
  };
}

export function clienteUsaReceptorSifenManual(cliente: { sifen_receptor_manual?: boolean | null }): boolean {
  return parseBoolCliente(cliente.sifen_receptor_manual);
}
