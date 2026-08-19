/**
 * Detalle de cobro de ventas (conciliación bancaria) vía pool raw-PG.
 *
 * Se inserta DESPUÉS de crear la venta (en la ruta API), best-effort: si falla,
 * la venta NO se rompe. No toca la transacción de venta ni la explosión de
 * recetas. Acceso por pool (no PostgREST) → sin dependencia del schema cache.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

export type MetodoPagoDetalle = "efectivo" | "transferencia" | "tarjeta" | "qr" | "billetera" | "otro";

export interface PagoDetalleInput {
  metodo_pago: MetodoPagoDetalle;
  entidad_bancaria_id: string | null;
  entidad_nombre_snapshot: string | null;
  monto: number;
  referencia: string | null;
  titular: string | null;
  fecha_acreditacion: string | null; // YYYY-MM-DD o null
  observacion: string | null;
}

export type TipoEntidad = "caja" | "banco" | "tarjeta" | "billetera" | "otro";

export interface EntidadBancariaRow {
  id: string;
  codigo: string | null;
  nombre: string;
  tipo: string | null;
  activo: boolean;
  orden: number;
}

export interface EntidadBancariaInput {
  codigo: string | null;
  nombre: string;
  tipo: TipoEntidad;
  activo: boolean;
  orden: number;
}

const ENT_COLS = "id, codigo, nombre, tipo, activo, orden";

/**
 * Lista entidades de la empresa. Por defecto solo activas (selector de cobro);
 * con `todas=true` devuelve también inactivas (gestión en Configuración).
 */
export async function listEntidadesBancarias(
  schemaRaw: string,
  empresaId: string,
  opts?: { todas?: boolean }
): Promise<EntidadBancariaRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "entidades_bancarias");
  const where = opts?.todas ? "empresa_id=$1::uuid" : "empresa_id=$1::uuid AND activo=true";
  const { rows } = await pool().query<EntidadBancariaRow>(
    `SELECT ${ENT_COLS} FROM ${t} WHERE ${where} ORDER BY orden ASC, nombre ASC`,
    [empresaId]
  );
  return rows;
}

/** Crea una entidad bancaria. Devuelve la fila creada. */
export async function insertEntidadBancaria(
  schemaRaw: string,
  empresaId: string,
  d: EntidadBancariaInput
): Promise<EntidadBancariaRow> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "entidades_bancarias");
  const { rows } = await pool().query<EntidadBancariaRow>(
    `INSERT INTO ${t} (empresa_id, codigo, nombre, tipo, activo, orden)
     VALUES ($1::uuid, $2, $3, $4, $5::boolean, $6::int)
     RETURNING ${ENT_COLS}`,
    [empresaId, d.codigo, d.nombre, d.tipo, d.activo, d.orden]
  );
  return rows[0];
}

/** Update parcial de una entidad. Devuelve la fila o null si no pertenece a la empresa. */
export async function updateEntidadBancaria(
  schemaRaw: string,
  empresaId: string,
  id: string,
  patch: Partial<EntidadBancariaInput>
): Promise<EntidadBancariaRow | null> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "entidades_bancarias");
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  const add = (col: string, val: unknown, cast = "") => { sets.push(`${col} = $${i}${cast}`); params.push(val); i++; };
  if (patch.codigo !== undefined) add("codigo", patch.codigo);
  if (patch.nombre !== undefined) add("nombre", patch.nombre);
  if (patch.tipo !== undefined) add("tipo", patch.tipo);
  if (patch.activo !== undefined) add("activo", patch.activo, "::boolean");
  if (patch.orden !== undefined) add("orden", patch.orden, "::int");
  if (sets.length === 0) {
    const { rows } = await pool().query<EntidadBancariaRow>(
      `SELECT ${ENT_COLS} FROM ${t} WHERE id=$1::uuid AND empresa_id=$2::uuid`, [id, empresaId]);
    return rows[0] ?? null;
  }
  sets.push("updated_at = now()");
  const idIdx = i, empIdx = i + 1;
  params.push(id, empresaId);
  const { rows } = await pool().query<EntidadBancariaRow>(
    `UPDATE ${t} SET ${sets.join(", ")} WHERE id=$${idIdx}::uuid AND empresa_id=$${empIdx}::uuid RETURNING ${ENT_COLS}`,
    params
  );
  return rows[0] ?? null;
}

/**
 * Inserta 1 detalle de cobro para una venta. Devuelve el id, o null si falla
 * (best-effort: el caller ignora el error para no romper la venta).
 */
export async function insertVentaPagoDetalle(
  schemaRaw: string,
  empresaId: string,
  ventaId: string,
  d: PagoDetalleInput
): Promise<string | null> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "ventas_pagos_detalle");
  const { rows } = await pool().query<{ id: string }>(
    `INSERT INTO ${t} (
        empresa_id, venta_id, metodo_pago, entidad_bancaria_id, entidad_nombre_snapshot,
        monto, referencia, titular, fecha_acreditacion, observacion
     ) VALUES (
        $1::uuid, $2::uuid, $3, $4::uuid, $5,
        $6::numeric, $7, $8, $9::date, $10
     ) RETURNING id`,
    [
      empresaId, ventaId, d.metodo_pago,
      d.entidad_bancaria_id, d.entidad_nombre_snapshot,
      d.monto, d.referencia, d.titular, d.fecha_acreditacion, d.observacion,
    ]
  );
  return rows[0]?.id ?? null;
}
