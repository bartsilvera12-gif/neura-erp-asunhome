/** Importadores de Categorias de producto y Ubicaciones (estructura similar, simple upsert). */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { normalizeUpperText, normalizeUpperNullable } from "@/lib/text/normalize";
import type { PreviewRow, PreviewResponse } from "@/lib/excel/import-types";
import { pick, pickBool, chunked } from "./import-helpers";

// ── CATEGORIAS DE PRODUCTO ────────────────────────────────────────────────

export interface CategoriaParsed {
  row_number: number;
  nombre: string;
  codigo: string | null;
  descripcion: string | null;
  parent_nombre: string;
  activo: boolean;
  errors: string[];
  warnings: string[];
  match_id?: string | null;
}

export function parseCategoriasRows(rows: Record<string, string>[]): CategoriaParsed[] {
  return rows.map((r, idx) => {
    const errors: string[] = [];
    const nombre = normalizeUpperText(pick(r, "NOMBRE"));
    if (!nombre) errors.push("NOMBRE obligatorio.");
    return {
      row_number: idx + 2,
      nombre,
      codigo: normalizeUpperNullable(pick(r, "CODIGO")),
      descripcion: normalizeUpperNullable(pick(r, "DESCRIPCION")),
      parent_nombre: normalizeUpperText(pick(r, "CATEGORIA_PADRE")),
      activo: pickBool(r, "ACTIVO"),
      errors, warnings: [],
    };
  });
}

export async function buildCatMap(schemaRaw: string, empresaId: string): Promise<Map<string, string>> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const pool = getChatPostgresPool();
  if (!pool) throw new Error("Pool no disponible.");
  const t = quoteSchemaTable(schema, "categorias_productos");
  const { rows } = await pool.query<{ id: string; nombre: string }>(
    `SELECT id, nombre FROM ${t} WHERE empresa_id=$1::uuid`, [empresaId]
  );
  const m = new Map<string, string>();
  for (const r of rows) m.set(r.nombre.trim().toUpperCase(), r.id);
  return m;
}

export function buildCatPreview(parsed: CategoriaParsed[], byName: Map<string, string>): PreviewResponse {
  const faltantesParent = new Set<string>();
  let insertar = 0, actualizar = 0, errores = 0, warnings = 0;
  const vistos = new Set<string>();
  const rows: PreviewRow[] = parsed.map((p) => {
    if (p.nombre && vistos.has(p.nombre)) p.errors.push(`NOMBRE duplicado en archivo: ${p.nombre}`);
    if (p.nombre) vistos.add(p.nombre);
    p.match_id = p.nombre ? (byName.get(p.nombre) ?? null) : null;
    if (p.parent_nombre && !byName.has(p.parent_nombre)) {
      p.warnings.push(`Categoría padre "${p.parent_nombre}" no existe.`);
      faltantesParent.add(p.parent_nombre);
    }
    const hasErr = p.errors.length > 0;
    const action = hasErr ? "ERROR" : p.match_id ? "UPDATE" : "INSERT";
    if (action === "INSERT") insertar++;
    else if (action === "UPDATE") actualizar++;
    else errores++;
    if (p.warnings.length > 0) warnings++;
    return {
      row_number: p.row_number, action, errors: p.errors, warnings: p.warnings,
      data: { NOMBRE: p.nombre, CODIGO: p.codigo ?? "", PARENT: p.parent_nombre, ACTIVO: p.activo ? "SI" : "NO" },
    };
  });
  return {
    summary: { total: parsed.length, insertar, actualizar, omitir: 0, errores, warnings,
      faltantes: { categorias: [...faltantesParent], proveedores: [], ubicaciones: [] } },
    rows,
    headers: ["NOMBRE","CODIGO","DESCRIPCION","CATEGORIA_PADRE","ACTIVO"],
  };
}

export interface CommitOut { inserted: number; updated: number; skipped: number; errors: number; warnings: number; errorMessages: string[]; warningMessages: string[] }

export async function commitCategorias(schemaRaw: string, empresaId: string, parsed: CategoriaParsed[], byName: Map<string, string>, crearFaltantes: boolean): Promise<CommitOut> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const pool = getChatPostgresPool();
  if (!pool) throw new Error("Pool no disponible.");
  const t = quoteSchemaTable(schema, "categorias_productos");
  const out: CommitOut = { inserted: 0, updated: 0, skipped: 0, errors: 0, warnings: 0, errorMessages: [], warningMessages: [] };
  if (crearFaltantes) {
    const faltantes = new Set<string>();
    for (const p of parsed) if (p.parent_nombre && !byName.has(p.parent_nombre)) faltantes.add(p.parent_nombre);
    for (const n of faltantes) {
      try {
        const r = await pool.query<{ id: string }>(`INSERT INTO ${t} (empresa_id, nombre, activo) VALUES ($1::uuid,$2,true) RETURNING id`, [empresaId, n]);
        byName.set(n, r.rows[0].id);
        out.warningMessages.push(`Categoría padre creada: ${n}`);
      } catch (e) { out.errorMessages.push(`No se pudo crear padre ${n}: ${(e as Error).message}`); }
    }
  }
  for (const chunk of chunked(parsed, 200)) {
    for (const p of chunk) {
      if (p.errors.length > 0) { out.errors++; out.errorMessages.push(`Fila ${p.row_number}: ${p.errors.join("; ")}`); continue; }
      const parentId = p.parent_nombre ? (byName.get(p.parent_nombre) ?? null) : null;
      try {
        if (p.match_id) {
          await pool.query(
            `UPDATE ${t} SET codigo=$1, descripcion=$2, parent_id=$3::uuid, activo=$4::boolean, updated_at=now()
             WHERE id=$5::uuid AND empresa_id=$6::uuid`,
            [p.codigo, p.descripcion, parentId, p.activo, p.match_id, empresaId]
          );
          out.updated++;
        } else {
          const r = await pool.query<{ id: string }>(
            `INSERT INTO ${t} (empresa_id, nombre, codigo, descripcion, parent_id, activo)
             VALUES ($1::uuid,$2,$3,$4,$5::uuid,$6::boolean) RETURNING id`,
            [empresaId, p.nombre, p.codigo, p.descripcion, parentId, p.activo]
          );
          byName.set(p.nombre, r.rows[0].id);
          out.inserted++;
        }
        if (p.warnings.length > 0) out.warnings++;
      } catch (e) {
        out.errors++;
        out.errorMessages.push(`Fila ${p.row_number}: ${(e as Error).message.slice(0, 200)}`);
      }
    }
  }
  return out;
}

export const CATEGORIAS_TEMPLATE_ROW = { NOMBRE: "ELECTRICIDAD", CODIGO: "ELE", DESCRIPCION: "PRODUCTOS ELECTRICOS", CATEGORIA_PADRE: "", ACTIVO: "SI" };

// ── UBICACIONES ───────────────────────────────────────────────────────────

const TIPOS_UBI = new Set(["deposito","salon","pasillo","gondola","estante","zona","otro"]);

export interface UbicacionParsed {
  row_number: number;
  nombre: string;
  codigo: string | null;
  tipo: string;
  parent_nombre: string;
  descripcion: string | null;
  activo: boolean;
  errors: string[];
  warnings: string[];
  match_id?: string | null;
}

export function parseUbicacionesRows(rows: Record<string, string>[]): UbicacionParsed[] {
  return rows.map((r, idx) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const nombre = normalizeUpperText(pick(r, "NOMBRE"));
    if (!nombre) errors.push("NOMBRE obligatorio.");
    let tipo = pick(r, "TIPO").toLowerCase();
    if (!tipo) { tipo = "otro"; warnings.push("TIPO vacío — se usará 'otro'."); }
    if (!TIPOS_UBI.has(tipo)) {
      warnings.push(`TIPO "${tipo}" inválido — se usará 'otro'.`);
      tipo = "otro";
    }
    return {
      row_number: idx + 2,
      nombre,
      codigo: normalizeUpperNullable(pick(r, "CODIGO")),
      tipo,
      parent_nombre: normalizeUpperText(pick(r, "UBICACION_PADRE")),
      descripcion: normalizeUpperNullable(pick(r, "DESCRIPCION")),
      activo: pickBool(r, "ACTIVO"),
      errors, warnings,
    };
  });
}

export interface UbiMaps { byName: Map<string, string>; byCodigo: Map<string, string> }

export async function buildUbiMaps(schemaRaw: string, empresaId: string): Promise<UbiMaps> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const pool = getChatPostgresPool();
  if (!pool) throw new Error("Pool no disponible.");
  const t = quoteSchemaTable(schema, "inventario_ubicaciones");
  const { rows } = await pool.query<{ id: string; nombre: string; codigo: string | null }>(
    `SELECT id, nombre, codigo FROM ${t} WHERE empresa_id=$1::uuid`, [empresaId]
  );
  const byName = new Map<string, string>(), byCodigo = new Map<string, string>();
  for (const r of rows) {
    byName.set(r.nombre.trim().toUpperCase(), r.id);
    if (r.codigo) byCodigo.set(r.codigo.trim().toUpperCase(), r.id);
  }
  return { byName, byCodigo };
}

export function buildUbiPreview(parsed: UbicacionParsed[], maps: UbiMaps): PreviewResponse {
  const faltantesParent = new Set<string>();
  let insertar = 0, actualizar = 0, errores = 0, warnings = 0;
  const vistos = new Set<string>();
  const rows: PreviewRow[] = parsed.map((p) => {
    if (p.nombre && vistos.has(p.nombre)) p.errors.push(`NOMBRE duplicado en archivo: ${p.nombre}`);
    if (p.nombre) vistos.add(p.nombre);
    p.match_id = (p.codigo && maps.byCodigo.get(p.codigo)) || (p.nombre && maps.byName.get(p.nombre)) || null;
    if (p.parent_nombre && !maps.byName.has(p.parent_nombre) && !maps.byCodigo.has(p.parent_nombre)) {
      p.warnings.push(`Ubicación padre "${p.parent_nombre}" no existe.`);
      faltantesParent.add(p.parent_nombre);
    }
    const hasErr = p.errors.length > 0;
    const action = hasErr ? "ERROR" : p.match_id ? "UPDATE" : "INSERT";
    if (action === "INSERT") insertar++;
    else if (action === "UPDATE") actualizar++;
    else errores++;
    if (p.warnings.length > 0) warnings++;
    return {
      row_number: p.row_number, action, errors: p.errors, warnings: p.warnings,
      data: { NOMBRE: p.nombre, CODIGO: p.codigo ?? "", TIPO: p.tipo, PARENT: p.parent_nombre },
    };
  });
  return {
    summary: { total: parsed.length, insertar, actualizar, omitir: 0, errores, warnings,
      faltantes: { categorias: [], proveedores: [], ubicaciones: [...faltantesParent] } },
    rows,
    headers: ["NOMBRE","CODIGO","TIPO","UBICACION_PADRE","DESCRIPCION","ACTIVO"],
  };
}

export async function commitUbicaciones(schemaRaw: string, empresaId: string, parsed: UbicacionParsed[], maps: UbiMaps, crearFaltantes: boolean): Promise<CommitOut> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const pool = getChatPostgresPool();
  if (!pool) throw new Error("Pool no disponible.");
  const t = quoteSchemaTable(schema, "inventario_ubicaciones");
  const out: CommitOut = { inserted: 0, updated: 0, skipped: 0, errors: 0, warnings: 0, errorMessages: [], warningMessages: [] };
  if (crearFaltantes) {
    const faltantes = new Set<string>();
    for (const p of parsed) {
      if (p.parent_nombre && !maps.byName.has(p.parent_nombre) && !maps.byCodigo.has(p.parent_nombre)) faltantes.add(p.parent_nombre);
    }
    for (const n of faltantes) {
      try {
        const r = await pool.query<{ id: string }>(`INSERT INTO ${t} (empresa_id, nombre, tipo, activo) VALUES ($1::uuid,$2,'otro',true) RETURNING id`, [empresaId, n]);
        maps.byName.set(n, r.rows[0].id);
        out.warningMessages.push(`Ubicación padre creada: ${n} (tipo: otro)`);
      } catch (e) { out.errorMessages.push(`No se pudo crear padre ${n}: ${(e as Error).message}`); }
    }
  }
  for (const chunk of chunked(parsed, 200)) {
    for (const p of chunk) {
      if (p.errors.length > 0) { out.errors++; out.errorMessages.push(`Fila ${p.row_number}: ${p.errors.join("; ")}`); continue; }
      const parentId = p.parent_nombre ? (maps.byName.get(p.parent_nombre) ?? maps.byCodigo.get(p.parent_nombre) ?? null) : null;
      try {
        if (p.match_id) {
          await pool.query(
            `UPDATE ${t} SET codigo=$1, tipo=$2, parent_id=$3::uuid, descripcion=$4, activo=$5::boolean, updated_at=now()
             WHERE id=$6::uuid AND empresa_id=$7::uuid`,
            [p.codigo, p.tipo, parentId, p.descripcion, p.activo, p.match_id, empresaId]
          );
          out.updated++;
        } else {
          const r = await pool.query<{ id: string }>(
            `INSERT INTO ${t} (empresa_id, nombre, codigo, tipo, parent_id, descripcion, activo)
             VALUES ($1::uuid,$2,$3,$4,$5::uuid,$6,$7::boolean) RETURNING id`,
            [empresaId, p.nombre, p.codigo, p.tipo, parentId, p.descripcion, p.activo]
          );
          maps.byName.set(p.nombre, r.rows[0].id);
          out.inserted++;
        }
        if (p.warnings.length > 0) out.warnings++;
      } catch (e) {
        out.errors++;
        out.errorMessages.push(`Fila ${p.row_number}: ${(e as Error).message.slice(0, 200)}`);
      }
    }
  }
  return out;
}

export const UBICACIONES_TEMPLATE_ROW = { NOMBRE: "DEPOSITO CENTRAL", CODIGO: "DEP-01", TIPO: "deposito", UBICACION_PADRE: "", DESCRIPCION: "DEPOSITO PRINCIPAL", ACTIVO: "SI" };
