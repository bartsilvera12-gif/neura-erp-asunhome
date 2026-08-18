import type {
  AmbienteSifen,
  EmpresaSifenConfigCreateBody,
  EmpresaSifenConfigCreateResult,
  EmpresaSifenConfigPatchResult,
  SifenCertificadoPasswordPatchAction,
} from "./types";
import { normalizePlazoCancelacionHoras } from "./sifen-cancelacion-rules";

function trimStr(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

/** Fecha inicio vigencia timbrado → columna `date` y XML `dFeIniT` (YYYY-MM-DD). */
export function normalizeTimbradoFechaInicioVigencia(
  raw: unknown
): { ok: true; value: string } | { ok: false; error: string } {
  const s = trimStr(raw);
  if (!s) {
    return {
      ok: false,
      error:
        "timbrado_fecha_inicio_vigencia es obligatoria: use la «Fecha inicio vigencia» del timbrado en DNIT (formato YYYY-MM-DD, ej. 2026-03-18).",
    };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return {
      ok: false,
      error: "timbrado_fecha_inicio_vigencia debe ser YYYY-MM-DD (ej. 2026-03-18).",
    };
  }
  const [, mo, da] = s.split("-").map((x) => parseInt(x, 10));
  if (mo < 1 || mo > 12 || da < 1 || da > 31) {
    return { ok: false, error: "timbrado_fecha_inicio_vigencia tiene mes o día inválido." };
  }
  const dt = new Date(`${s}T12:00:00.000Z`);
  if (Number.isNaN(dt.getTime())) {
    return { ok: false, error: "timbrado_fecha_inicio_vigencia no es una fecha válida." };
  }
  return { ok: true, value: s };
}

/** cActEco / dDesActEco: deben coincidir con el catálogo y la actividad declarada para el RUC. */
export function normalizeActividadEconomica(
  codigoRaw: unknown,
  descRaw: unknown
): { ok: true; codigo: string; descripcion: string } | { ok: false; error: string } {
  const codigo = trimStr(codigoRaw);
  const descripcion = trimStr(descRaw);
  if (!codigo) {
    return {
      ok: false,
      error:
        "actividad_economica_codigo es obligatorio (código numérico del catálogo SET / e-kuatia para su actividad principal).",
    };
  }
  if (!/^\d{4,8}$/.test(codigo)) {
    return {
      ok: false,
      error: "actividad_economica_codigo debe ser numérico de 4 a 8 dígitos (catálogo SET).",
    };
  }
  if (!descripcion) {
    return {
      ok: false,
      error:
        "actividad_economica_descripcion es obligatoria (texto oficial del catálogo para ese código; error SET 1261 si no coincide).",
    };
  }
  if (descripcion.length > 600) {
    return { ok: false, error: "actividad_economica_descripcion es demasiado larga." };
  }
  return { ok: true, codigo, descripcion };
}

export function parseAmbiente(v: unknown): AmbienteSifen | null {
  const s = trimStr(v);
  if (s === "test" || s === "produccion") return s;
  return null;
}

/**
 * Normaliza un color hex `#RRGGBB` (3 dígitos `#RGB` expandido automáticamente).
 * Solo permitido para personalización KuDE/PDF: nunca toca XML, firma ni SET.
 */
function normalizeHexColor(
  raw: unknown
): { ok: true; value: string } | { ok: false; error: string } {
  const s = trimStr(raw);
  if (!s) return { ok: false, error: "color vacío" };
  const m3 = /^#([0-9A-Fa-f]{3})$/.exec(s);
  if (m3) {
    const a = m3[1]!;
    return { ok: true, value: `#${a[0]}${a[0]}${a[1]}${a[1]}${a[2]}${a[2]}`.toLowerCase() };
  }
  const m6 = /^#([0-9A-Fa-f]{6})$/.exec(s);
  if (m6) return { ok: true, value: `#${m6[1]!.toLowerCase()}` };
  return { ok: false, error: "color debe ser #RRGGBB (ej. #0ea5e9)" };
}

type PasswordWire =
  | { kind: "omit" }
  | { kind: "clear" }
  | { kind: "set"; value: string }
  | { kind: "error"; message: string };

function parseCertificadoPasswordWire(b: Record<string, unknown>): PasswordWire {
  if (!("certificado_password" in b)) return { kind: "omit" };
  if (b.certificado_password === null) return { kind: "clear" };
  const s = String(b.certificado_password);
  if (s === "") {
    return {
      kind: "error",
      message:
        "certificado_password no puede ser una cadena vacía; omita el campo o use null para borrar el secreto guardado",
    };
  }
  return { kind: "set", value: s };
}

/** Valida y normaliza el body de creación (POST). */
export function validateCreateBody(raw: unknown): EmpresaSifenConfigCreateResult {
  if (raw == null || typeof raw !== "object") {
    return { ok: false, error: "El cuerpo debe ser un objeto JSON" };
  }
  const b = raw as Record<string, unknown>;

  const ambiente = parseAmbiente(b.ambiente);
  if (!ambiente) {
    return {
      ok: false,
      error: "ambiente es obligatorio y debe ser 'test' o 'produccion'",
    };
  }

  const ruc = trimStr(b.ruc);
  const razon_social = trimStr(b.razon_social);
  const timbrado_numero = trimStr(b.timbrado_numero);
  const establecimiento = trimStr(b.establecimiento);
  const punto_expedicion = trimStr(b.punto_expedicion);

  if (!ruc) return { ok: false, error: "ruc es obligatorio" };
  if (!razon_social) return { ok: false, error: "razon_social es obligatoria" };
  if (!timbrado_numero) return { ok: false, error: "timbrado_numero es obligatorio" };
  const tin = normalizeTimbradoFechaInicioVigencia(b.timbrado_fecha_inicio_vigencia);
  if (!tin.ok) return { ok: false, error: tin.error };
  const act = normalizeActividadEconomica(b.actividad_economica_codigo, b.actividad_economica_descripcion);
  if (!act.ok) return { ok: false, error: act.error };
  if (!establecimiento) return { ok: false, error: "establecimiento es obligatorio" };
  if (!punto_expedicion) return { ok: false, error: "punto_expedicion es obligatorio" };

  const pw = parseCertificadoPasswordWire(b);
  if (pw.kind === "error") return { ok: false, error: pw.message };

  let certificado_password: string | null | undefined;
  if (pw.kind === "omit") certificado_password = undefined;
  else if (pw.kind === "clear") certificado_password = null;
  else certificado_password = pw.value;

  let certificado_vencimiento = optionalNullableString(b.certificado_vencimiento);
  if (certificado_vencimiento != null && certificado_vencimiento !== "") {
    const d = new Date(certificado_vencimiento);
    if (Number.isNaN(d.getTime())) {
      return { ok: false, error: "certificado_vencimiento no es una fecha válida (ISO 8601)" };
    }
    certificado_vencimiento = d.toISOString();
  }

  const data: EmpresaSifenConfigCreateBody = {
    ruc,
    razon_social,
    direccion_fiscal: optionalNullableString(b.direccion_fiscal),
    timbrado_numero,
    timbrado_fecha_inicio_vigencia: tin.value,
    actividad_economica_codigo: act.codigo,
    actividad_economica_descripcion: act.descripcion,
    establecimiento,
    punto_expedicion,
    ambiente,
    csc: optionalNullableString(b.csc),
    certificado_path: optionalNullableString(b.certificado_path),
    certificado_password,
    certificado_vencimiento,
    activo: typeof b.activo === "boolean" ? b.activo : undefined,
  };

  if ("sifen_plazo_cancelacion_horas" in b) {
    if (b.sifen_plazo_cancelacion_horas === null) {
      return { ok: false, error: "sifen_plazo_cancelacion_horas no puede ser null" };
    }
    if (typeof b.sifen_plazo_cancelacion_horas !== "number" || !Number.isFinite(b.sifen_plazo_cancelacion_horas)) {
      return { ok: false, error: "sifen_plazo_cancelacion_horas debe ser un número entero de horas" };
    }
    data.sifen_plazo_cancelacion_horas = normalizePlazoCancelacionHoras(b.sifen_plazo_cancelacion_horas);
  }

  if ("kude_color_primario" in b) {
    if (b.kude_color_primario === null) {
      data.kude_color_primario = null;
    } else {
      const c = normalizeHexColor(b.kude_color_primario);
      if (!c.ok) return { ok: false, error: `kude_color_primario: ${c.error}` };
      data.kude_color_primario = c.value;
    }
  }
  if ("kude_color_primario_fill" in b) {
    if (b.kude_color_primario_fill === null) {
      data.kude_color_primario_fill = null;
    } else {
      const c = normalizeHexColor(b.kude_color_primario_fill);
      if (!c.ok) return { ok: false, error: `kude_color_primario_fill: ${c.error}` };
      data.kude_color_primario_fill = c.value;
    }
  }

  return { ok: true, data };
}

function optionalNullableString(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** Construye objeto de actualización para Supabase (PATCH), sin contraseña en claro. */
export function buildPatchUpdate(raw: unknown): EmpresaSifenConfigPatchResult {
  if (raw == null || typeof raw !== "object") {
    return { ok: false, error: "El cuerpo debe ser un objeto JSON" };
  }
  const b = raw as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  const pw = parseCertificadoPasswordWire(b);
  if (pw.kind === "error") return { ok: false, error: pw.message };

  const password: SifenCertificadoPasswordPatchAction =
    pw.kind === "omit"
      ? { kind: "omit" }
      : pw.kind === "clear"
        ? { kind: "clear" }
        : { kind: "set", value: pw.value };

  if ("ruc" in b) {
    const v = trimStr(b.ruc);
    if (!v) return { ok: false, error: "ruc no puede quedar vacío" };
    patch.ruc = v;
  }
  if ("razon_social" in b) {
    const v = trimStr(b.razon_social);
    if (!v) return { ok: false, error: "razon_social no puede quedar vacía" };
    patch.razon_social = v;
  }
  if ("direccion_fiscal" in b) {
    patch.direccion_fiscal = b.direccion_fiscal === null ? null : trimStr(b.direccion_fiscal) || null;
  }
  if ("timbrado_numero" in b) {
    const v = trimStr(b.timbrado_numero);
    if (!v) return { ok: false, error: "timbrado_numero no puede quedar vacío" };
    patch.timbrado_numero = v;
  }
  if ("timbrado_fecha_inicio_vigencia" in b) {
    const tin = normalizeTimbradoFechaInicioVigencia(b.timbrado_fecha_inicio_vigencia);
    if (!tin.ok) return { ok: false, error: tin.error };
    patch.timbrado_fecha_inicio_vigencia = tin.value;
  }
  if ("actividad_economica_codigo" in b || "actividad_economica_descripcion" in b) {
    const act = normalizeActividadEconomica(b.actividad_economica_codigo, b.actividad_economica_descripcion);
    if (!act.ok) return { ok: false, error: act.error };
    patch.actividad_economica_codigo = act.codigo;
    patch.actividad_economica_descripcion = act.descripcion;
  }
  if ("establecimiento" in b) {
    const v = trimStr(b.establecimiento);
    if (!v) return { ok: false, error: "establecimiento no puede quedar vacío" };
    patch.establecimiento = v;
  }
  if ("punto_expedicion" in b) {
    const v = trimStr(b.punto_expedicion);
    if (!v) return { ok: false, error: "punto_expedicion no puede quedar vacío" };
    patch.punto_expedicion = v;
  }
  if ("ambiente" in b) {
    const a = parseAmbiente(b.ambiente);
    if (!a) return { ok: false, error: "ambiente debe ser 'test' o 'produccion'" };
    patch.ambiente = a;
  }
  if ("csc" in b) patch.csc = b.csc === null ? null : trimStr(b.csc) || null;
  if ("certificado_path" in b) {
    patch.certificado_path = b.certificado_path === null ? null : trimStr(b.certificado_path) || null;
  }
  if ("certificado_vencimiento" in b) {
    if (b.certificado_vencimiento === null || b.certificado_vencimiento === "") {
      patch.certificado_vencimiento = null;
    } else {
      const s = String(b.certificado_vencimiento).trim();
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) {
        return { ok: false, error: "certificado_vencimiento no es una fecha válida (ISO 8601)" };
      }
      patch.certificado_vencimiento = d.toISOString();
    }
  }
  if ("activo" in b) {
    if (typeof b.activo !== "boolean") {
      return { ok: false, error: "activo debe ser booleano" };
    }
    patch.activo = b.activo;
  }
  if ("sifen_plazo_cancelacion_horas" in b) {
    if (b.sifen_plazo_cancelacion_horas === null) {
      return { ok: false, error: "sifen_plazo_cancelacion_horas no puede ser null" };
    }
    if (typeof b.sifen_plazo_cancelacion_horas !== "number" || !Number.isFinite(b.sifen_plazo_cancelacion_horas)) {
      return { ok: false, error: "sifen_plazo_cancelacion_horas debe ser un número entero de horas" };
    }
    patch.sifen_plazo_cancelacion_horas = normalizePlazoCancelacionHoras(b.sifen_plazo_cancelacion_horas);
  }

  if ("kude_color_primario" in b) {
    if (b.kude_color_primario === null) {
      patch.kude_color_primario = null;
    } else {
      const c = normalizeHexColor(b.kude_color_primario);
      if (!c.ok) return { ok: false, error: `kude_color_primario: ${c.error}` };
      patch.kude_color_primario = c.value;
    }
  }
  if ("kude_color_primario_fill" in b) {
    if (b.kude_color_primario_fill === null) {
      patch.kude_color_primario_fill = null;
    } else {
      const c = normalizeHexColor(b.kude_color_primario_fill);
      if (!c.ok) return { ok: false, error: `kude_color_primario_fill: ${c.error}` };
      patch.kude_color_primario_fill = c.value;
    }
  }

  if (Object.keys(patch).length === 0 && password.kind === "omit") {
    return { ok: false, error: "No se envió ningún campo para actualizar" };
  }

  return { ok: true, patch, password };
}

/** Fila insert sin contraseña en claro (la API cifra y asigna certificado_password_encrypted). */
export function rowFromCreateBody(empresaId: string, body: EmpresaSifenConfigCreateBody): Record<string, unknown> {
  const row: Record<string, unknown> = {
    empresa_id: empresaId,
    ambiente: body.ambiente,
    ruc: body.ruc,
    razon_social: body.razon_social,
    timbrado_numero: body.timbrado_numero,
    timbrado_fecha_inicio_vigencia: body.timbrado_fecha_inicio_vigencia,
    actividad_economica_codigo: body.actividad_economica_codigo,
    actividad_economica_descripcion: body.actividad_economica_descripcion,
    establecimiento: body.establecimiento,
    punto_expedicion: body.punto_expedicion,
    csc: body.csc ?? null,
    certificado_path: body.certificado_path ?? null,
    activo: body.activo ?? true,
  };
  if (body.certificado_vencimiento != null) {
    row.certificado_vencimiento = body.certificado_vencimiento;
  }
  if (body.direccion_fiscal !== undefined) {
    row.direccion_fiscal = body.direccion_fiscal;
  }
  if (body.sifen_plazo_cancelacion_horas !== undefined) {
    row.sifen_plazo_cancelacion_horas = normalizePlazoCancelacionHoras(body.sifen_plazo_cancelacion_horas);
  }
  if (body.kude_color_primario !== undefined) {
    row.kude_color_primario = body.kude_color_primario;
  }
  if (body.kude_color_primario_fill !== undefined) {
    row.kude_color_primario_fill = body.kude_color_primario_fill;
  }
  return row;
}
