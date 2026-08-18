import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { normalizeUpperText, normalizeUpperNullable } from "@/lib/text/normalize";
import type { PreviewRow, PreviewResponse } from "@/lib/excel/import-types";
import { pick, pickBool, chunked } from "./import-helpers";

export interface ProveedorParsed {
  row_number: number;
  nombre: string;
  nombre_comercial: string | null;
  ruc: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  contacto: string | null;
  rubros: string[];
  observaciones: string | null;
  activo: boolean;
  errors: string[];
  warnings: string[];
  match_id?: string | null;
}

export function parseProveedoresRows(rows: Record<string, string>[]): ProveedorParsed[] {
  return rows.map((r, idx) => {
    const errors: string[] = [];
    const nombre = normalizeUpperText(pick(r, "RAZON_SOCIAL_NOMBRE", "RAZON_SOCIAL", "NOMBRE"));
    if (!nombre) errors.push("RAZON_SOCIAL_NOMBRE obligatorio.");
    const emailRaw = pick(r, "EMAIL");
    const email = emailRaw ? emailRaw.toLowerCase() : null;
    const rubrosRaw = pick(r, "RUBROS");
    const rubros = rubrosRaw
      ? rubrosRaw.split(",").map((s) => normalizeUpperText(s)).filter(Boolean)
      : [];
    return {
      row_number: idx + 2,
      nombre,
      nombre_comercial: normalizeUpperNullable(pick(r, "NOMBRE_COMERCIAL")),
      ruc: normalizeUpperNullable(pick(r, "RUC")),
      telefono: pick(r, "TELEFONO") || null,
      email,
      direccion: normalizeUpperNullable(pick(r, "DIRECCION")),
      contacto: normalizeUpperNullable(pick(r, "CONTACTO")),
      rubros,
      observaciones: normalizeUpperNullable(pick(r, "OBSERVACIONES")),
      activo: pickBool(r, "ACTIVO"),
      errors,
      warnings: [],
    };
  });
}

interface ProvEx { id: string; nombre: string; ruc: string | null }

export interface ProvResolverMaps {
  byRuc: Map<string, ProvEx>;
  byNombre: Map<string, ProvEx>;
  rubrosByName: Map<string, string>;
}

export async function buildProvResolverMaps(schemaRaw: string, empresaId: string): Promise<ProvResolverMaps> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const pool = getChatPostgresPool();
  if (!pool) throw new Error("Pool no disponible.");
  const tP = quoteSchemaTable(schema, "proveedores");
  const tC = quoteSchemaTable(schema, "proveedor_categorias");
  const [prods, cats] = await Promise.all([
    pool.query<ProvEx>(`SELECT id, nombre, ruc FROM ${tP} WHERE empresa_id=$1::uuid`, [empresaId]),
    pool.query<{ id: string; nombre: string }>(`SELECT id, nombre FROM ${tC} WHERE empresa_id=$1::uuid AND activo=true`, [empresaId]),
  ]);
  const byRuc = new Map<string, ProvEx>();
  const byNombre = new Map<string, ProvEx>();
  for (const p of prods.rows) {
    if (p.ruc) byRuc.set(p.ruc.toUpperCase(), p);
    byNombre.set(p.nombre.trim().toUpperCase(), p);
  }
  const rubrosByName = new Map<string, string>();
  for (const c of cats.rows) rubrosByName.set(c.nombre.trim().toUpperCase(), c.id);
  return { byRuc, byNombre, rubrosByName };
}

export function buildProvPreview(parsed: ProveedorParsed[], maps: ProvResolverMaps): PreviewResponse {
  const rubrosFaltantes = new Set<string>();
  let insertar = 0, actualizar = 0, errores = 0, warnings = 0;
  const rucsVistos = new Set<string>();
  const rows: PreviewRow[] = parsed.map((p) => {
    if (p.ruc && rucsVistos.has(p.ruc)) p.errors.push(`RUC duplicado en archivo: ${p.ruc}`);
    if (p.ruc) rucsVistos.add(p.ruc);
    let matchId: string | null = null;
    if (p.ruc && maps.byRuc.has(p.ruc)) matchId = maps.byRuc.get(p.ruc)!.id;
    else if (!p.ruc && maps.byNombre.has(p.nombre)) matchId = maps.byNombre.get(p.nombre)!.id;
    p.match_id = matchId;
    for (const ru of p.rubros) {
      if (!maps.rubrosByName.has(ru)) {
        p.warnings.push(`Rubro "${ru}" no existe.`);
        rubrosFaltantes.add(ru);
      }
    }
    const hasErr = p.errors.length > 0;
    const action = hasErr ? "ERROR" : matchId ? "UPDATE" : "INSERT";
    if (action === "INSERT") insertar++;
    else if (action === "UPDATE") actualizar++;
    else errores++;
    if (p.warnings.length > 0) warnings++;
    return {
      row_number: p.row_number, action, errors: p.errors, warnings: p.warnings,
      data: { RAZON_SOCIAL: p.nombre, RUC: p.ruc ?? "", EMAIL: p.email ?? "", RUBROS: p.rubros.join(", ") },
    };
  });
  return {
    summary: {
      total: parsed.length, insertar, actualizar, omitir: 0, errores, warnings,
      faltantes: { categorias: [...rubrosFaltantes], proveedores: [], ubicaciones: [] },
    },
    rows,
    headers: ["RAZON_SOCIAL_NOMBRE","NOMBRE_COMERCIAL","RUC","TELEFONO","EMAIL","DIRECCION","CONTACTO","RUBROS","OBSERVACIONES","ACTIVO"],
  };
}

export interface ProvCommit { inserted: number; updated: number; skipped: number; errors: number; warnings: number; errorMessages: string[]; warningMessages: string[] }

export async function commitProveedores(
  schemaRaw: string, empresaId: string, parsed: ProveedorParsed[], maps: ProvResolverMaps, crearFaltantes: boolean
): Promise<ProvCommit> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const pool = getChatPostgresPool();
  if (!pool) throw new Error("Pool no disponible.");
  const tP = quoteSchemaTable(schema, "proveedores");
  const tC = quoteSchemaTable(schema, "proveedor_categorias");
  const tR = quoteSchemaTable(schema, "proveedor_categoria_rel");
  const out: ProvCommit = { inserted: 0, updated: 0, skipped: 0, errors: 0, warnings: 0, errorMessages: [], warningMessages: [] };

  if (crearFaltantes) {
    const faltantes = new Set<string>();
    for (const p of parsed) for (const ru of p.rubros) if (!maps.rubrosByName.has(ru)) faltantes.add(ru);
    for (const ru of faltantes) {
      try {
        const r = await pool.query<{ id: string }>(`INSERT INTO ${tC} (empresa_id, nombre, activo) VALUES ($1::uuid,$2,true) RETURNING id`, [empresaId, ru]);
        maps.rubrosByName.set(ru, r.rows[0].id);
        out.warningMessages.push(`Rubro creado: ${ru}`);
      } catch (e) { out.errorMessages.push(`No se pudo crear rubro ${ru}: ${(e as Error).message}`); }
    }
  }

  for (const chunk of chunked(parsed, 200)) {
    for (const p of chunk) {
      if (p.errors.length > 0) { out.errors++; out.errorMessages.push(`Fila ${p.row_number}: ${p.errors.join("; ")}`); continue; }
      try {
        let pid = p.match_id ?? null;
        if (pid) {
          await pool.query(
            `UPDATE ${tP} SET
               nombre=$1, nombre_comercial=$2, ruc=$3, telefono=$4, email=$5,
               direccion=$6, contacto=$7, observaciones=$8,
               estado=$9, updated_at=now()
             WHERE id=$10::uuid AND empresa_id=$11::uuid`,
            [p.nombre, p.nombre_comercial, p.ruc, p.telefono, p.email,
             p.direccion, p.contacto, p.observaciones,
             p.activo ? "activo" : "inactivo", pid, empresaId]
          );
          out.updated++;
        } else {
          const r = await pool.query<{ id: string }>(
            `INSERT INTO ${tP} (
               empresa_id, nombre, nombre_comercial, razon_social, ruc, telefono, email,
               direccion, contacto, estado
             ) VALUES ($1::uuid,$2,$3,$2,$4,$5,$6,$7,$8,$9) RETURNING id`,
            [empresaId, p.nombre, p.nombre_comercial, p.ruc, p.telefono, p.email,
             p.direccion, p.contacto, p.activo ? "activo" : "inactivo"]
          );
          pid = r.rows[0].id;
          out.inserted++;
        }
        // Rubros relacionados
        if (p.rubros.length > 0 && pid) {
          const rubroIds = p.rubros.map((r) => maps.rubrosByName.get(r)).filter((x): x is string => !!x);
          if (rubroIds.length > 0) {
            await pool.query(`DELETE FROM ${tR} WHERE empresa_id=$1::uuid AND proveedor_id=$2::uuid`, [empresaId, pid]);
            const values = rubroIds.map((_, i) => `($1::uuid, $2::uuid, $${i + 3}::uuid)`).join(",");
            await pool.query(`INSERT INTO ${tR} (empresa_id, proveedor_id, categoria_id) VALUES ${values}`, [empresaId, pid, ...rubroIds]);
          }
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

export const PROVEEDORES_TEMPLATE_ROW = {
  RAZON_SOCIAL_NOMBRE: "DISTRIBUIDORA EJEMPLO S.A.",
  NOMBRE_COMERCIAL: "DON HERRAMIENTAS",
  RUC: "80012345-6",
  TELEFONO: "0981-123456",
  EMAIL: "ventas@ejemplo.com",
  DIRECCION: "AV. ASUNCION 1234",
  CONTACTO: "JUAN PEREZ",
  RUBROS: "ELECTRICIDAD, PLOMERIA",
  OBSERVACIONES: "",
  ACTIVO: "SI",
};
