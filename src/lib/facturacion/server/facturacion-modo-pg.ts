/**
 * Capa PG directo para configuracion fiscal general:
 *   - empresa_facturacion_modo (modo + flags al confirmar venta)
 *   - empresa_autoimpresor_config (datos timbrado factura impresa)
 *
 * NO toca empresa_sifen_config. Convive.
 *
 * Defaults seguros: si la empresa no tiene fila aun, getFacturacionModo
 * devuelve modo='sin_factura_fiscal'/impresion='pdf_a4'/flags=false.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

export type FacturacionModoTipo = "sin_factura_fiscal" | "sifen" | "autoimpresor";
export type ImpresionTipo = "pdf_a4" | "pdf_media_hoja" | "ticket_80mm" | "ticket_58mm";

export interface FacturacionModoRow {
  empresa_id: string;
  modo: FacturacionModoTipo;
  impresion_tipo_default: ImpresionTipo;
  imprimir_al_confirmar: boolean;
  preguntar_datos_al_confirmar: boolean;
  activo: boolean;
  created_at: string;
  updated_at: string;
}

const FM_COLS = `
  empresa_id, modo, impresion_tipo_default,
  imprimir_al_confirmar, preguntar_datos_al_confirmar,
  activo, created_at, updated_at
`;

/** Default seguro cuando no hay fila aun. */
export function defaultFacturacionModo(empresaId: string): FacturacionModoRow {
  const now = new Date().toISOString();
  return {
    empresa_id: empresaId,
    modo: "sin_factura_fiscal",
    impresion_tipo_default: "pdf_a4",
    imprimir_al_confirmar: false,
    preguntar_datos_al_confirmar: false,
    activo: true,
    created_at: now,
    updated_at: now,
  };
}

export async function getFacturacionModo(
  schemaRaw: string,
  empresaId: string
): Promise<FacturacionModoRow> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "empresa_facturacion_modo");
  const { rows } = await pool().query<FacturacionModoRow>(
    `SELECT ${FM_COLS} FROM ${t} WHERE empresa_id = $1::uuid LIMIT 1`,
    [empresaId]
  );
  return rows[0] ?? defaultFacturacionModo(empresaId);
}

export interface FacturacionModoPatch {
  modo?: FacturacionModoTipo;
  impresion_tipo_default?: ImpresionTipo;
  imprimir_al_confirmar?: boolean;
  preguntar_datos_al_confirmar?: boolean;
  activo?: boolean;
}

export async function upsertFacturacionModo(
  schemaRaw: string,
  empresaId: string,
  p: FacturacionModoPatch
): Promise<FacturacionModoRow> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "empresa_facturacion_modo");
  const base = await getFacturacionModo(schema, empresaId);
  const merged = {
    modo: p.modo ?? base.modo,
    impresion_tipo_default: p.impresion_tipo_default ?? base.impresion_tipo_default,
    imprimir_al_confirmar: p.imprimir_al_confirmar ?? base.imprimir_al_confirmar,
    preguntar_datos_al_confirmar: p.preguntar_datos_al_confirmar ?? base.preguntar_datos_al_confirmar,
    activo: p.activo ?? base.activo,
  };
  const { rows } = await pool().query<FacturacionModoRow>(
    `INSERT INTO ${t} (empresa_id, modo, impresion_tipo_default,
                       imprimir_al_confirmar, preguntar_datos_al_confirmar, activo)
     VALUES ($1::uuid, $2, $3, $4::boolean, $5::boolean, $6::boolean)
     ON CONFLICT (empresa_id) DO UPDATE SET
       modo = EXCLUDED.modo,
       impresion_tipo_default = EXCLUDED.impresion_tipo_default,
       imprimir_al_confirmar = EXCLUDED.imprimir_al_confirmar,
       preguntar_datos_al_confirmar = EXCLUDED.preguntar_datos_al_confirmar,
       activo = EXCLUDED.activo,
       updated_at = now()
     RETURNING ${FM_COLS}`,
    [empresaId, merged.modo, merged.impresion_tipo_default,
     merged.imprimir_al_confirmar, merged.preguntar_datos_al_confirmar, merged.activo]
  );
  return rows[0];
}

// ─── Autoimpresor ────────────────────────────────────────────────────────

export interface AutoimpresorRow {
  empresa_id: string;
  activo: boolean;
  ruc_emisor: string | null;
  razon_social_emisor: string | null;
  nombre_fantasia: string | null;
  direccion_matriz: string | null;
  telefono: string | null;
  timbrado_numero: string | null;
  timbrado_inicio_vigencia: string | null;
  timbrado_fin_vigencia: string | null;
  establecimiento_codigo: string | null;
  punto_expedicion_codigo: string | null;
  numero_actual: number | null;
  numero_inicial: number | null;
  numero_final: number | null;
  tipo_documento_default: string;
  formato_impresion_default: ImpresionTipo;
  leyenda_papel_termico: string | null;
  observaciones: string | null;
  created_at: string;
  updated_at: string;
}

const AI_COLS = `
  empresa_id, activo, ruc_emisor, razon_social_emisor, nombre_fantasia,
  direccion_matriz, telefono, timbrado_numero,
  timbrado_inicio_vigencia, timbrado_fin_vigencia,
  establecimiento_codigo, punto_expedicion_codigo,
  numero_actual, numero_inicial, numero_final,
  tipo_documento_default, formato_impresion_default,
  leyenda_papel_termico, observaciones,
  created_at, updated_at
`;

export function defaultAutoimpresor(empresaId: string): AutoimpresorRow {
  const now = new Date().toISOString();
  return {
    empresa_id: empresaId,
    activo: false,
    ruc_emisor: null, razon_social_emisor: null, nombre_fantasia: null,
    direccion_matriz: null, telefono: null,
    timbrado_numero: null, timbrado_inicio_vigencia: null, timbrado_fin_vigencia: null,
    establecimiento_codigo: null, punto_expedicion_codigo: null,
    numero_actual: null, numero_inicial: null, numero_final: null,
    tipo_documento_default: "factura",
    formato_impresion_default: "pdf_a4",
    leyenda_papel_termico: null, observaciones: null,
    created_at: now, updated_at: now,
  };
}

export async function getAutoimpresor(
  schemaRaw: string,
  empresaId: string
): Promise<AutoimpresorRow> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "empresa_autoimpresor_config");
  const { rows } = await pool().query<AutoimpresorRow>(
    `SELECT ${AI_COLS} FROM ${t} WHERE empresa_id = $1::uuid LIMIT 1`,
    [empresaId]
  );
  return rows[0] ?? defaultAutoimpresor(empresaId);
}

export interface AutoimpresorPatch {
  activo?: boolean;
  ruc_emisor?: string | null;
  razon_social_emisor?: string | null;
  nombre_fantasia?: string | null;
  direccion_matriz?: string | null;
  telefono?: string | null;
  timbrado_numero?: string | null;
  timbrado_inicio_vigencia?: string | null;
  timbrado_fin_vigencia?: string | null;
  establecimiento_codigo?: string | null;
  punto_expedicion_codigo?: string | null;
  numero_actual?: number | null;
  numero_inicial?: number | null;
  numero_final?: number | null;
  tipo_documento_default?: string;
  formato_impresion_default?: ImpresionTipo;
  leyenda_papel_termico?: string | null;
  observaciones?: string | null;
}

export async function upsertAutoimpresor(
  schemaRaw: string,
  empresaId: string,
  p: AutoimpresorPatch
): Promise<AutoimpresorRow> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "empresa_autoimpresor_config");
  const base = await getAutoimpresor(schema, empresaId);
  const m = {
    activo: p.activo ?? base.activo,
    ruc_emisor: p.ruc_emisor !== undefined ? p.ruc_emisor : base.ruc_emisor,
    razon_social_emisor: p.razon_social_emisor !== undefined ? p.razon_social_emisor : base.razon_social_emisor,
    nombre_fantasia: p.nombre_fantasia !== undefined ? p.nombre_fantasia : base.nombre_fantasia,
    direccion_matriz: p.direccion_matriz !== undefined ? p.direccion_matriz : base.direccion_matriz,
    telefono: p.telefono !== undefined ? p.telefono : base.telefono,
    timbrado_numero: p.timbrado_numero !== undefined ? p.timbrado_numero : base.timbrado_numero,
    timbrado_inicio_vigencia: p.timbrado_inicio_vigencia !== undefined ? p.timbrado_inicio_vigencia : base.timbrado_inicio_vigencia,
    timbrado_fin_vigencia: p.timbrado_fin_vigencia !== undefined ? p.timbrado_fin_vigencia : base.timbrado_fin_vigencia,
    establecimiento_codigo: p.establecimiento_codigo !== undefined ? p.establecimiento_codigo : base.establecimiento_codigo,
    punto_expedicion_codigo: p.punto_expedicion_codigo !== undefined ? p.punto_expedicion_codigo : base.punto_expedicion_codigo,
    numero_actual: p.numero_actual !== undefined ? p.numero_actual : base.numero_actual,
    numero_inicial: p.numero_inicial !== undefined ? p.numero_inicial : base.numero_inicial,
    numero_final: p.numero_final !== undefined ? p.numero_final : base.numero_final,
    tipo_documento_default: p.tipo_documento_default ?? base.tipo_documento_default,
    formato_impresion_default: p.formato_impresion_default ?? base.formato_impresion_default,
    leyenda_papel_termico: p.leyenda_papel_termico !== undefined ? p.leyenda_papel_termico : base.leyenda_papel_termico,
    observaciones: p.observaciones !== undefined ? p.observaciones : base.observaciones,
  };
  const { rows } = await pool().query<AutoimpresorRow>(
    `INSERT INTO ${t} (
       empresa_id, activo, ruc_emisor, razon_social_emisor, nombre_fantasia,
       direccion_matriz, telefono, timbrado_numero,
       timbrado_inicio_vigencia, timbrado_fin_vigencia,
       establecimiento_codigo, punto_expedicion_codigo,
       numero_actual, numero_inicial, numero_final,
       tipo_documento_default, formato_impresion_default,
       leyenda_papel_termico, observaciones
     ) VALUES (
       $1::uuid, $2::boolean, $3, $4, $5,
       $6, $7, $8,
       $9::date, $10::date,
       $11, $12,
       $13::integer, $14::integer, $15::integer,
       $16, $17,
       $18, $19
     )
     ON CONFLICT (empresa_id) DO UPDATE SET
       activo = EXCLUDED.activo,
       ruc_emisor = EXCLUDED.ruc_emisor,
       razon_social_emisor = EXCLUDED.razon_social_emisor,
       nombre_fantasia = EXCLUDED.nombre_fantasia,
       direccion_matriz = EXCLUDED.direccion_matriz,
       telefono = EXCLUDED.telefono,
       timbrado_numero = EXCLUDED.timbrado_numero,
       timbrado_inicio_vigencia = EXCLUDED.timbrado_inicio_vigencia,
       timbrado_fin_vigencia = EXCLUDED.timbrado_fin_vigencia,
       establecimiento_codigo = EXCLUDED.establecimiento_codigo,
       punto_expedicion_codigo = EXCLUDED.punto_expedicion_codigo,
       numero_actual = EXCLUDED.numero_actual,
       numero_inicial = EXCLUDED.numero_inicial,
       numero_final = EXCLUDED.numero_final,
       tipo_documento_default = EXCLUDED.tipo_documento_default,
       formato_impresion_default = EXCLUDED.formato_impresion_default,
       leyenda_papel_termico = EXCLUDED.leyenda_papel_termico,
       observaciones = EXCLUDED.observaciones,
       updated_at = now()
     RETURNING ${AI_COLS}`,
    [empresaId, m.activo, m.ruc_emisor, m.razon_social_emisor, m.nombre_fantasia,
     m.direccion_matriz, m.telefono, m.timbrado_numero,
     m.timbrado_inicio_vigencia, m.timbrado_fin_vigencia,
     m.establecimiento_codigo, m.punto_expedicion_codigo,
     m.numero_actual, m.numero_inicial, m.numero_final,
     m.tipo_documento_default, m.formato_impresion_default,
     m.leyenda_papel_termico, m.observaciones]
  );
  return rows[0];
}

/** Valida configuracion minima de autoimpresor si activo=true. */
export function validateAutoimpresor(d: AutoimpresorPatch & { activo?: boolean }): string[] {
  const errors: string[] = [];
  if (!d.activo) return errors;
  if (!d.timbrado_numero?.trim()) errors.push("Timbrado obligatorio.");
  if (!d.establecimiento_codigo?.trim()) errors.push("Establecimiento obligatorio.");
  if (!d.punto_expedicion_codigo?.trim()) errors.push("Punto de expedición obligatorio.");
  if (d.numero_actual == null) errors.push("Número actual obligatorio.");
  if (d.numero_inicial == null) errors.push("Número inicial obligatorio.");
  if (d.numero_final == null) errors.push("Número final obligatorio.");
  if (d.numero_inicial != null && d.numero_final != null && d.numero_inicial > d.numero_final) {
    errors.push("Número inicial debe ser ≤ número final.");
  }
  if (d.numero_actual != null && d.numero_inicial != null && d.numero_actual < d.numero_inicial) {
    errors.push("Número actual no puede ser menor al inicial.");
  }
  if (d.numero_actual != null && d.numero_final != null && d.numero_actual > d.numero_final) {
    errors.push("Número actual no puede ser mayor al final.");
  }
  if (!d.timbrado_fin_vigencia) errors.push("Fin de vigencia del timbrado obligatorio.");
  return errors;
}
