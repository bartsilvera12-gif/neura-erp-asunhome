/**
 * Números de serie por unidad (producto_series).
 *
 * Una fila = una unidad física identificada por su número de serie. Es lo que
 * permite responder "este televisor averiado, ¿de qué proveedor vino?".
 *
 * Solo aplica a productos con maneja_series = true. El resto sigue por cantidad.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

export type SerieEstado =
  | "en_stock" | "reservado" | "vendido" | "averiado"
  | "en_servicio" | "devuelto_proveedor" | "baja";

export interface SerieRow {
  id: string;
  producto_id: string;
  producto_nombre: string | null;
  sku: string | null;
  numero_serie: string;
  estado: SerieEstado;
  ubicacion_id: string | null;
  ubicacion_nombre: string | null;
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  compra_id: string | null;
  /** N° de la factura de compra que trajo la unidad (JOIN compras por compra_id). */
  compra_numero_control: string | null;
  compra_fecha: string | null;
  venta_id: string | null;
  /** N° de la venta donde se vendió la unidad (JOIN ventas por venta_id). */
  venta_numero_control: string | null;
  cliente_id: string | null;
  cliente_nombre: string | null;
  costo_unitario: number | null;
  precio_venta: number | null;
  fecha_ingreso: string;
  fecha_venta: string | null;
  garantia_hasta: string | null;
  observaciones: string | null;
}

const SEL = `
  s.id, s.producto_id, p.nombre AS producto_nombre, p.sku,
  s.numero_serie, s.estado, s.ubicacion_id, u.nombre AS ubicacion_nombre,
  s.proveedor_id, pr.nombre AS proveedor_nombre,
  s.compra_id, co.numero_control AS compra_numero_control, co.fecha AS compra_fecha,
  s.venta_id, ve.numero_control AS venta_numero_control, s.cliente_id, cl.nombre AS cliente_nombre,
  s.costo_unitario, s.precio_venta, s.fecha_ingreso, s.fecha_venta,
  s.garantia_hasta, s.observaciones`;

function joins(schema: string): string {
  const t = (n: string) => quoteSchemaTable(schema, n);
  return `
    FROM ${t("producto_series")} s
    LEFT JOIN ${t("productos")} p               ON p.id = s.producto_id
    LEFT JOIN ${t("inventario_ubicaciones")} u  ON u.id = s.ubicacion_id
    LEFT JOIN ${t("proveedores")} pr            ON pr.id = s.proveedor_id
    LEFT JOIN ${t("clientes")} cl               ON cl.id = s.cliente_id
    LEFT JOIN ${t("compras")} co                ON co.id = s.compra_id
    LEFT JOIN ${t("ventas")} ve                 ON ve.id = s.venta_id`;
}

export interface ListSeriesOpts {
  productoId?: string;
  estado?: SerieEstado;
  q?: string;          // búsqueda parcial por número de serie
  limit?: number;
}

export async function listSeries(
  schemaRaw: string,
  empresaId: string,
  opts: ListSeriesOpts = {}
): Promise<SerieRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const cond: string[] = ["s.empresa_id = $1::uuid"];
  const params: unknown[] = [empresaId];
  let i = 2;
  if (opts.productoId) { cond.push(`s.producto_id = $${i}::uuid`); params.push(opts.productoId); i++; }
  if (opts.estado)     { cond.push(`s.estado = $${i}`); params.push(opts.estado); i++; }
  if (opts.q && opts.q.trim()) {
    cond.push(`s.numero_serie ILIKE $${i}`); params.push(`%${opts.q.trim()}%`); i++;
  }
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);

  const { rows } = await pool().query<SerieRow>(
    `SELECT ${SEL} ${joins(schema)}
      WHERE ${cond.join(" AND ")}
      ORDER BY s.fecha_ingreso DESC
      LIMIT ${limit}`,
    params
  );
  return rows;
}

export async function getSerie(
  schemaRaw: string, empresaId: string, id: string
): Promise<SerieRow | null> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const { rows } = await pool().query<SerieRow>(
    `SELECT ${SEL} ${joins(schema)} WHERE s.empresa_id = $1::uuid AND s.id = $2::uuid`,
    [empresaId, id]
  );
  return rows[0] ?? null;
}

export interface SerieInput {
  numero_serie: string;
  ubicacion_id?: string | null;
  proveedor_id?: string | null;
  compra_id?: string | null;
  costo_unitario?: number | null;
  observaciones?: string | null;
  garantia_hasta?: string | null;
}

/**
 * Alta de varias series de un mismo producto (entrada de inventario/compra).
 * Ignora las vacías y salta duplicadas sin abortar el lote.
 * Devuelve cuántas creó y las series que ya existían.
 */
export async function insertSeries(
  schemaRaw: string,
  empresaId: string,
  productoId: string,
  series: SerieInput[],
  createdBy?: string | null
): Promise<{ creadas: number; duplicadas: string[] }> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "producto_series");
  let creadas = 0;
  const duplicadas: string[] = [];

  for (const s of series) {
    const nro = (s.numero_serie ?? "").trim();
    if (!nro) continue;
    try {
      const { rowCount } = await pool().query(
        `INSERT INTO ${t}
           (empresa_id, producto_id, numero_serie, estado, ubicacion_id,
            proveedor_id, compra_id, costo_unitario, observaciones, garantia_hasta, created_by)
         VALUES ($1::uuid,$2::uuid,$3,'en_stock',$4::uuid,$5::uuid,$6::uuid,$7,$8,$9::date,$10::uuid)
         ON CONFLICT (empresa_id, lower(btrim(numero_serie))) DO NOTHING`,
        [empresaId, productoId, nro, s.ubicacion_id ?? null, s.proveedor_id ?? null,
         s.compra_id ?? null, s.costo_unitario ?? null, s.observaciones ?? null,
         s.garantia_hasta ?? null, createdBy ?? null]
      );
      if ((rowCount ?? 0) > 0) creadas++;
      else duplicadas.push(nro);
    } catch {
      duplicadas.push(nro);
    }
  }
  return { creadas, duplicadas };
}

/** Series disponibles para vender de un producto (estado en_stock). */
export async function listSeriesDisponibles(
  schemaRaw: string, empresaId: string, productoId: string
): Promise<SerieRow[]> {
  return listSeries(schemaRaw, empresaId, { productoId, estado: "en_stock", limit: 1000 });
}

/** Cambia el estado de una serie (y datos asociados). Uso interno de flujos. */
export async function actualizarSerie(
  schemaRaw: string,
  empresaId: string,
  id: string,
  patch: Partial<{
    estado: SerieEstado;
    ubicacion_id: string | null;
    venta_id: string | null;
    venta_item_id: string | null;
    cliente_id: string | null;
    precio_venta: number | null;
    fecha_venta: string | null;
    observaciones: string | null;
    updated_by: string | null;
  }>
): Promise<SerieRow | null> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "producto_series");
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  const add = (col: string, val: unknown, cast = "") => { sets.push(`${col} = $${i}${cast}`); params.push(val); i++; };
  if (patch.estado !== undefined)        add("estado", patch.estado);
  if (patch.ubicacion_id !== undefined)  add("ubicacion_id", patch.ubicacion_id, "::uuid");
  if (patch.venta_id !== undefined)      add("venta_id", patch.venta_id, "::uuid");
  if (patch.venta_item_id !== undefined) add("venta_item_id", patch.venta_item_id, "::uuid");
  if (patch.cliente_id !== undefined)    add("cliente_id", patch.cliente_id, "::uuid");
  if (patch.precio_venta !== undefined)  add("precio_venta", patch.precio_venta);
  if (patch.fecha_venta !== undefined)   add("fecha_venta", patch.fecha_venta, "::timestamptz");
  if (patch.observaciones !== undefined) add("observaciones", patch.observaciones);
  if (patch.updated_by !== undefined)    add("updated_by", patch.updated_by, "::uuid");
  if (sets.length === 0) return getSerie(schemaRaw, empresaId, id);
  sets.push("updated_at = now()");
  params.push(id, empresaId);
  const { rowCount } = await pool().query(
    `UPDATE ${t} SET ${sets.join(", ")} WHERE id = $${i}::uuid AND empresa_id = $${i + 1}::uuid`,
    params
  );
  if ((rowCount ?? 0) === 0) return null;
  return getSerie(schemaRaw, empresaId, id);
}

export async function deleteSerie(
  schemaRaw: string, empresaId: string, id: string
): Promise<boolean> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "producto_series");
  // Solo se puede borrar una serie que sigue en stock (no vendida ni con historia).
  const { rowCount } = await pool().query(
    `DELETE FROM ${t} WHERE id = $1::uuid AND empresa_id = $2::uuid AND estado = 'en_stock'`,
    [id, empresaId]
  );
  return (rowCount ?? 0) > 0;
}
