/**
 * PG directo para Proveedores y Categorias de proveedor.
 * Mismo patron que productos-pg.ts y catalogos-pg.ts:
 *   - getChatPostgresPool() + quoteSchemaTable()
 *   - schema validado por assertAllowedChatDataSchema()
 *   - valores via placeholders $N
 *   - soporta tenants erp_* NO expuestos por PostgREST
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import type { Pool } from "pg";

function pool(): Pool {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool de Postgres no disponible.");
  return p;
}

// ─── Categorias de proveedor ──────────────────────────────────────────────

export interface ProveedorCategoriaRow {
  id: string;
  empresa_id: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  created_at: string;
  updated_at: string;
}

export async function listProveedorCategorias(
  schemaRaw: string,
  empresaId: string,
  opts: { soloActivas?: boolean } = {}
): Promise<ProveedorCategoriaRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "proveedor_categorias");
  const where = ["empresa_id = $1::uuid"];
  if (opts.soloActivas !== false) where.push("activo = true");
  const { rows } = await pool().query<ProveedorCategoriaRow>(
    `SELECT id, empresa_id, nombre, descripcion, activo, created_at, updated_at
       FROM ${t} WHERE ${where.join(" AND ")} ORDER BY nombre`,
    [empresaId]
  );
  return rows;
}

export async function insertProveedorCategoria(
  schemaRaw: string,
  empresaId: string,
  d: { nombre: string; descripcion?: string | null; activo?: boolean }
): Promise<ProveedorCategoriaRow> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "proveedor_categorias");
  const { rows } = await pool().query<ProveedorCategoriaRow>(
    `INSERT INTO ${t} (empresa_id, nombre, descripcion, activo)
     VALUES ($1::uuid, $2, $3, COALESCE($4::boolean, true))
     RETURNING id, empresa_id, nombre, descripcion, activo, created_at, updated_at`,
    [empresaId, d.nombre, d.descripcion ?? null, d.activo ?? true]
  );
  return rows[0];
}

export async function updateProveedorCategoria(
  schemaRaw: string,
  empresaId: string,
  id: string,
  d: Partial<{ nombre: string; descripcion: string | null; activo: boolean }>
): Promise<ProveedorCategoriaRow | null> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "proveedor_categorias");
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (d.nombre !== undefined) { sets.push(`nombre = $${i++}`); params.push(d.nombre); }
  if (d.descripcion !== undefined) { sets.push(`descripcion = $${i++}`); params.push(d.descripcion); }
  if (d.activo !== undefined) { sets.push(`activo = $${i++}::boolean`); params.push(d.activo); }
  if (sets.length === 0) return null;
  sets.push("updated_at = now()");
  params.push(id, empresaId);
  const { rows } = await pool().query<ProveedorCategoriaRow>(
    `UPDATE ${t} SET ${sets.join(", ")}
       WHERE id = $${i++}::uuid AND empresa_id = $${i}::uuid
       RETURNING id, empresa_id, nombre, descripcion, activo, created_at, updated_at`,
    params
  );
  return rows[0] ?? null;
}

// ─── Proveedores ──────────────────────────────────────────────────────────

export interface ProveedorRow {
  id: string;
  empresa_id: string;
  nombre: string;
  nombre_comercial: string | null;
  razon_social: string | null;
  ruc: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  contacto: string | null;
  estado: string;
  condicion_pago: string | null;
  plazo_pago_dias: number | null;
  moneda_preferida: string | null;
  observaciones: string | null;
  created_at: string;
  updated_at: string;
}

const PROV_COLS = `
  id, empresa_id, nombre, nombre_comercial, razon_social, ruc, telefono, email,
  direccion, contacto, estado, condicion_pago, plazo_pago_dias, moneda_preferida,
  observaciones, created_at, updated_at
`;

export async function listProveedores(
  schemaRaw: string,
  empresaId: string
): Promise<ProveedorRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "proveedores");
  const { rows } = await pool().query<ProveedorRow>(
    `SELECT ${PROV_COLS} FROM ${t} WHERE empresa_id = $1::uuid ORDER BY nombre`,
    [empresaId]
  );
  return rows;
}

export async function getProveedorById(
  schemaRaw: string,
  empresaId: string,
  id: string
): Promise<ProveedorRow | null> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "proveedores");
  const { rows } = await pool().query<ProveedorRow>(
    `SELECT ${PROV_COLS} FROM ${t} WHERE id = $1::uuid AND empresa_id = $2::uuid LIMIT 1`,
    [id, empresaId]
  );
  return rows[0] ?? null;
}

export interface InsertProveedorInput {
  nombre: string;
  nombre_comercial?: string | null;
  razon_social?: string | null;
  ruc?: string | null;
  telefono?: string | null;
  email?: string | null;
  direccion?: string | null;
  contacto?: string | null;
  estado?: "activo" | "inactivo";
  condicion_pago?: "contado" | "credito" | "mixto" | null;
  plazo_pago_dias?: number | null;
  moneda_preferida?: "GS" | "USD" | null;
  observaciones?: string | null;
}

export async function findProveedorByRuc(
  schemaRaw: string,
  empresaId: string,
  ruc: string
): Promise<{ id: string; nombre: string } | null> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "proveedores");
  const { rows } = await pool().query<{ id: string; nombre: string }>(
    `SELECT id, nombre FROM ${t}
      WHERE empresa_id = $1::uuid AND ruc = $2 LIMIT 1`,
    [empresaId, ruc]
  );
  return rows[0] ?? null;
}

export async function insertProveedor(
  schemaRaw: string,
  empresaId: string,
  d: InsertProveedorInput
): Promise<ProveedorRow> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "proveedores");
  const { rows } = await pool().query<ProveedorRow>(
    `INSERT INTO ${t} (
       empresa_id, nombre, nombre_comercial, razon_social, ruc, telefono, email,
       direccion, contacto, estado, condicion_pago, plazo_pago_dias,
       moneda_preferida, observaciones
     ) VALUES (
       $1::uuid, $2, $3, $4, $5, $6, $7,
       $8, $9, $10, $11, $12::integer, $13, $14
     ) RETURNING ${PROV_COLS}`,
    [
      empresaId,
      d.nombre,
      d.nombre_comercial ?? null,
      d.razon_social ?? null,
      d.ruc ?? null,
      d.telefono ?? null,
      d.email ?? null,
      d.direccion ?? null,
      d.contacto ?? null,
      d.estado ?? "activo",
      d.condicion_pago ?? null,
      d.plazo_pago_dias ?? null,
      d.moneda_preferida ?? null,
      d.observaciones ?? null,
    ]
  );
  return rows[0];
}

export async function updateProveedor(
  schemaRaw: string,
  empresaId: string,
  id: string,
  d: Partial<InsertProveedorInput>
): Promise<ProveedorRow | null> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "proveedores");
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  const setIf = (col: string, val: unknown, cast = "") => {
    sets.push(`${col} = $${i}${cast}`);
    params.push(val);
    i++;
  };
  if (d.nombre !== undefined) setIf("nombre", d.nombre);
  if (d.nombre_comercial !== undefined) setIf("nombre_comercial", d.nombre_comercial ?? null);
  if (d.razon_social !== undefined) setIf("razon_social", d.razon_social ?? null);
  if (d.ruc !== undefined) setIf("ruc", d.ruc ?? null);
  if (d.telefono !== undefined) setIf("telefono", d.telefono ?? null);
  if (d.email !== undefined) setIf("email", d.email ?? null);
  if (d.direccion !== undefined) setIf("direccion", d.direccion ?? null);
  if (d.contacto !== undefined) setIf("contacto", d.contacto ?? null);
  if (d.estado !== undefined) setIf("estado", d.estado);
  if (d.condicion_pago !== undefined) setIf("condicion_pago", d.condicion_pago ?? null);
  if (d.plazo_pago_dias !== undefined) setIf("plazo_pago_dias", d.plazo_pago_dias ?? null, "::integer");
  if (d.moneda_preferida !== undefined) setIf("moneda_preferida", d.moneda_preferida ?? null);
  if (d.observaciones !== undefined) setIf("observaciones", d.observaciones ?? null);
  if (sets.length === 0) return await getProveedorById(schemaRaw, empresaId, id);
  sets.push("updated_at = now()");
  params.push(id, empresaId);
  const { rows } = await pool().query<ProveedorRow>(
    `UPDATE ${t} SET ${sets.join(", ")}
       WHERE id = $${i++}::uuid AND empresa_id = $${i}::uuid
       RETURNING ${PROV_COLS}`,
    params
  );
  return rows[0] ?? null;
}

export async function deleteProveedor(
  schemaRaw: string,
  empresaId: string,
  id: string
): Promise<boolean> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "proveedores");
  const { rowCount } = await pool().query(
    `DELETE FROM ${t} WHERE id = $1::uuid AND empresa_id = $2::uuid`,
    [id, empresaId]
  );
  return (rowCount ?? 0) > 0;
}

// ─── Relacion proveedor <-> categorias ────────────────────────────────────

export interface RelRow {
  id: string;
  proveedor_id: string;
  categoria_id: string;
}

export async function listRelaciones(
  schemaRaw: string,
  empresaId: string
): Promise<RelRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "proveedor_categoria_rel");
  try {
    const { rows } = await pool().query<RelRow>(
      `SELECT id, proveedor_id, categoria_id FROM ${t} WHERE empresa_id = $1::uuid`,
      [empresaId]
    );
    return rows;
  } catch (err) {
    // Si la tabla no existe en este tenant, devolver vacio en vez de tirar 500.
    const msg = err instanceof Error ? err.message : "";
    if (/does not exist/i.test(msg)) return [];
    throw err;
  }
}

export async function listCategoriasMin(
  schemaRaw: string,
  empresaId: string
): Promise<{ id: string; nombre: string; activo: boolean }[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "proveedor_categorias");
  try {
    const { rows } = await pool().query<{ id: string; nombre: string; activo: boolean }>(
      `SELECT id, nombre, activo FROM ${t} WHERE empresa_id = $1::uuid`,
      [empresaId]
    );
    return rows;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (/does not exist/i.test(msg)) return [];
    throw err;
  }
}

export async function listRelacionesDeProveedor(
  schemaRaw: string,
  empresaId: string,
  proveedorId: string
): Promise<string[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "proveedor_categoria_rel");
  const { rows } = await pool().query<{ categoria_id: string }>(
    `SELECT categoria_id FROM ${t}
      WHERE empresa_id = $1::uuid AND proveedor_id = $2::uuid`,
    [empresaId, proveedorId]
  );
  return rows.map((r) => r.categoria_id);
}

export async function replaceRelacionesProveedor(
  schemaRaw: string,
  empresaId: string,
  proveedorId: string,
  categoriaIds: string[]
): Promise<void> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "proveedor_categoria_rel");
  const tCat = quoteSchemaTable(schema, "proveedor_categorias");
  const p = pool();
  // 1) Validar que las categorias pertenezcan a la empresa
  const ids = categoriaIds.filter((x) => typeof x === "string" && x.length > 0);
  let validIds: string[] = [];
  if (ids.length > 0) {
    const { rows } = await p.query<{ id: string }>(
      `SELECT id FROM ${tCat} WHERE empresa_id = $1::uuid AND id = ANY($2::uuid[])`,
      [empresaId, ids]
    );
    validIds = rows.map((r) => r.id);
  }
  // 2) Borrar todas + insertar las nuevas
  await p.query(
    `DELETE FROM ${t} WHERE empresa_id = $1::uuid AND proveedor_id = $2::uuid`,
    [empresaId, proveedorId]
  );
  if (validIds.length > 0) {
    const values = validIds.map((_, idx) => `($1::uuid, $2::uuid, $${idx + 3}::uuid)`).join(", ");
    await p.query(
      `INSERT INTO ${t} (empresa_id, proveedor_id, categoria_id) VALUES ${values}`,
      [empresaId, proveedorId, ...validIds]
    );
  }
}

