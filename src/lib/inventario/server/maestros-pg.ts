/**
 * Maestros de inventario: marcas y líneas de producto.
 *
 * Ambas tablas tienen la misma forma (nombre, código, descripción, activo), así
 * que comparten implementación. `marcas` agrega `proveedor_id` — el proveedor
 * habitual de la marca, que es lo que permite el reporte por proveedor.
 *
 * Acceso por pool raw-PG, igual que el resto de los maestros: no depende del
 * schema cache de PostgREST.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

export type MaestroTabla = "marcas" | "lineas_producto";

export interface MaestroRow {
  id: string;
  nombre: string;
  codigo: string | null;
  descripcion: string | null;
  activo: boolean;
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  /** Productos que hoy apuntan a este maestro. Sirve para avisar antes de borrar. */
  productos: number;
}

export interface MaestroInput {
  nombre: string;
  codigo: string | null;
  descripcion: string | null;
  activo: boolean;
  proveedor_id: string | null;
}

/** Columna de `productos` que referencia cada maestro. */
function fkCol(tabla: MaestroTabla): string {
  return tabla === "marcas" ? "marca_id" : "linea_id";
}

export async function listMaestro(
  schemaRaw: string,
  empresaId: string,
  tabla: MaestroTabla,
  opts?: { todas?: boolean }
): Promise<MaestroRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, tabla);
  const tProd = quoteSchemaTable(schema, "productos");
  const tProv = quoteSchemaTable(schema, "proveedores");
  const col = fkCol(tabla);
  const esMarca = tabla === "marcas";

  const { rows } = await pool().query<MaestroRow>(
    `SELECT m.id, m.nombre, m.codigo, m.descripcion, m.activo,
            ${esMarca ? "m.proveedor_id" : "NULL::uuid AS proveedor_id"},
            ${esMarca ? "pr.nombre AS proveedor_nombre" : "NULL::text AS proveedor_nombre"},
            (SELECT count(*)::int FROM ${tProd} p
              WHERE p.empresa_id = m.empresa_id AND p.${col} = m.id) AS productos
       FROM ${t} m
       ${esMarca ? `LEFT JOIN ${tProv} pr ON pr.id = m.proveedor_id` : ""}
      WHERE m.empresa_id = $1::uuid
        ${opts?.todas ? "" : "AND m.activo = true"}
      ORDER BY m.activo DESC, lower(m.nombre)`,
    [empresaId]
  );
  return rows;
}

export async function insertMaestro(
  schemaRaw: string,
  empresaId: string,
  tabla: MaestroTabla,
  input: MaestroInput
): Promise<MaestroRow> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, tabla);
  const esMarca = tabla === "marcas";

  const cols = ["empresa_id", "nombre", "codigo", "descripcion", "activo"];
  const vals: unknown[] = [empresaId, input.nombre, input.codigo, input.descripcion, input.activo];
  if (esMarca) {
    cols.push("proveedor_id");
    vals.push(input.proveedor_id);
  }
  const placeholders = cols.map((c, i) => (c === "empresa_id" || c.endsWith("_id") ? `$${i + 1}::uuid` : `$${i + 1}`));

  const { rows } = await pool().query<{ id: string }>(
    `INSERT INTO ${t} (${cols.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING id`,
    vals
  );
  const creado = await getMaestro(schemaRaw, empresaId, tabla, rows[0].id);
  if (!creado) throw new Error("No se pudo leer el registro creado.");
  return creado;
}

export async function getMaestro(
  schemaRaw: string,
  empresaId: string,
  tabla: MaestroTabla,
  id: string
): Promise<MaestroRow | null> {
  const todas = await listMaestro(schemaRaw, empresaId, tabla, { todas: true });
  return todas.find((r) => r.id === id) ?? null;
}

export async function updateMaestro(
  schemaRaw: string,
  empresaId: string,
  tabla: MaestroTabla,
  id: string,
  patch: Partial<MaestroInput>
): Promise<MaestroRow | null> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, tabla);
  const esMarca = tabla === "marcas";

  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  const add = (col: string, val: unknown, cast = "") => {
    sets.push(`${col} = $${i}${cast}`);
    params.push(val);
    i++;
  };
  if (patch.nombre !== undefined) add("nombre", patch.nombre);
  if (patch.codigo !== undefined) add("codigo", patch.codigo);
  if (patch.descripcion !== undefined) add("descripcion", patch.descripcion);
  if (patch.activo !== undefined) add("activo", patch.activo, "::boolean");
  if (esMarca && patch.proveedor_id !== undefined) add("proveedor_id", patch.proveedor_id, "::uuid");

  if (sets.length === 0) return getMaestro(schemaRaw, empresaId, tabla, id);

  sets.push("updated_at = now()");
  params.push(id, empresaId);
  const { rowCount } = await pool().query(
    `UPDATE ${t} SET ${sets.join(", ")} WHERE id = $${i}::uuid AND empresa_id = $${i + 1}::uuid`,
    params
  );
  if ((rowCount ?? 0) === 0) return null;
  return getMaestro(schemaRaw, empresaId, tabla, id);
}

/**
 * Borra el maestro. Las FKs de `productos` son ON DELETE SET NULL: los productos
 * NO se pierden, quedan sin marca/línea. Se devuelve cuántos quedaron sueltos
 * para poder avisarlo.
 */
export async function deleteMaestro(
  schemaRaw: string,
  empresaId: string,
  tabla: MaestroTabla,
  id: string
): Promise<{ deleted: boolean; productosAfectados: number }> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, tabla);
  const tProd = quoteSchemaTable(schema, "productos");
  const col = fkCol(tabla);

  const { rows: usoRows } = await pool().query<{ n: string }>(
    `SELECT count(*)::text AS n FROM ${tProd} WHERE empresa_id = $1::uuid AND ${col} = $2::uuid`,
    [empresaId, id]
  );
  const productosAfectados = Number(usoRows[0]?.n ?? 0);

  const { rowCount } = await pool().query(
    `DELETE FROM ${t} WHERE id = $1::uuid AND empresa_id = $2::uuid`,
    [id, empresaId]
  );
  return { deleted: (rowCount ?? 0) > 0, productosAfectados };
}
