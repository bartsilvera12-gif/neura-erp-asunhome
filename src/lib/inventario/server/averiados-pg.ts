/**
 * Productos averiados — así les dice la dueña a los devueltos por el cliente
 * (modelo equivocado, falla). NO se sacan del stock: siguen contando como
 * inventario de la empresa, solo quedan identificados como averiados.
 *
 * (Los dañados de fábrica van al módulo "En el técnico", que sí resta stock.)
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

export type AveriadoEstado =
  | "detectado" | "en_revision" | "en_garantia_proveedor"
  | "reparado" | "descartado" | "devuelto_proveedor";

export interface AveriadoRow {
  id: string;
  producto_id: string;
  producto_nombre: string | null;
  sku: string | null;
  numero_serie: string | null;
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  cantidad: number;
  motivo: string;
  etiqueta: string | null;
  descripcion: string | null;
  estado: AveriadoEstado;
  recuperado: boolean;
  fecha_deteccion: string;
  fecha_resolucion: string | null;
  observaciones: string | null;
}

const SEL = `
  a.id, a.producto_id, p.nombre AS producto_nombre, p.sku, a.numero_serie,
  a.proveedor_id, pr.nombre AS proveedor_nombre, a.cantidad, a.motivo,
  a.etiqueta, a.descripcion, a.estado, a.recuperado, a.fecha_deteccion, a.fecha_resolucion,
  a.observaciones`;

function joins(schema: string): string {
  const t = (n: string) => quoteSchemaTable(schema, n);
  return `
    FROM ${t("productos_averiados")} a
    LEFT JOIN ${t("productos")} p    ON p.id = a.producto_id
    LEFT JOIN ${t("proveedores")} pr ON pr.id = a.proveedor_id`;
}

export async function listAveriados(
  schemaRaw: string,
  empresaId: string,
  opts: { estado?: AveriadoEstado; q?: string; soloActivos?: boolean } = {}
): Promise<AveriadoRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const cond: string[] = ["a.empresa_id = $1::uuid", "a.motivo = 'cliente'"];
  const params: unknown[] = [empresaId];
  let i = 2;
  if (opts.estado)     { cond.push(`a.estado = $${i}`); params.push(opts.estado); i++; }
  if (opts.soloActivos) cond.push(`a.estado NOT IN ('descartado','reparado','devuelto_proveedor')`);
  if (opts.q && opts.q.trim()) {
    cond.push(`(p.nombre ILIKE $${i} OR a.numero_serie ILIKE $${i})`);
    params.push(`%${opts.q.trim()}%`); i++;
  }
  const { rows } = await pool().query<AveriadoRow>(
    `SELECT ${SEL} ${joins(schema)} WHERE ${cond.join(" AND ")} ORDER BY a.fecha_deteccion DESC LIMIT 500`,
    params
  );
  return rows;
}

export interface AveriadoInput {
  producto_id: string;
  etiqueta?: string | null;
  serie_id?: string | null;
  numero_serie?: string | null;
  proveedor_id?: string | null;
  cantidad?: number;
  descripcion?: string | null;
  observaciones?: string | null;
  venta_id?: string | null;   // devolución que lo originó (traza)
}

/** Registra un averiado de cliente. NO toca stock. */
export async function crearAveriado(
  schemaRaw: string,
  empresaId: string,
  input: AveriadoInput,
  reportadoPor?: string | null
): Promise<string> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "productos_averiados");
  const { rows } = await pool().query<{ id: string }>(
    `INSERT INTO ${t}
       (empresa_id, producto_id, serie_id, numero_serie, proveedor_id, cantidad,
        motivo, etiqueta, descripcion, observaciones, estado, reportado_por)
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6,'cliente',$7,$8,$9,'detectado',$10::uuid)
     RETURNING id`,
    [empresaId, input.producto_id, input.serie_id ?? null, input.numero_serie ?? null,
     input.proveedor_id ?? null, input.cantidad ?? 1, (input.etiqueta ?? 'Averiado'),
     input.descripcion ?? null, input.observaciones ?? null, reportadoPor ?? null]
  );
  // Si trae serie, marcar la unidad como averiada (sin sacarla de stock).
  if (input.serie_id) {
    try {
      const ts = quoteSchemaTable(schema, "producto_series");
      await pool().query(
        `UPDATE ${ts} SET estado = 'averiado', updated_at = now()
          WHERE id = $1::uuid AND empresa_id = $2::uuid`,
        [input.serie_id, empresaId]
      );
    } catch { /* la serie es opcional */ }
  }
  return rows[0].id;
}

export async function actualizarAveriado(
  schemaRaw: string,
  empresaId: string,
  id: string,
  patch: Partial<{ estado: AveriadoEstado; etiqueta: string | null; observaciones: string | null; recuperado: boolean }>,
  resueltoPor?: string | null
): Promise<boolean> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "productos_averiados");
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  const add = (c: string, v: unknown, cast = "") => { sets.push(`${c} = $${i}${cast}`); params.push(v); i++; };
  if (patch.estado !== undefined) {
    add("estado", patch.estado);
    if (["reparado", "descartado", "devuelto_proveedor"].includes(patch.estado)) {
      sets.push("fecha_resolucion = now()");
      add("resuelto_por", resueltoPor ?? null, "::uuid");
    }
  }
  if (patch.etiqueta !== undefined) add("etiqueta", patch.etiqueta);
  if (patch.observaciones !== undefined) add("observaciones", patch.observaciones);
  if (patch.recuperado !== undefined) add("recuperado", patch.recuperado, "::boolean");
  if (sets.length === 0) return false;
  sets.push("updated_at = now()");
  params.push(id, empresaId);
  const { rowCount } = await pool().query(
    `UPDATE ${t} SET ${sets.join(", ")} WHERE id = $${i}::uuid AND empresa_id = $${i + 1}::uuid`,
    params
  );
  return (rowCount ?? 0) > 0;
}
