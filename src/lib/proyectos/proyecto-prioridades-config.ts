import "server-only";

import { fetchDataSchemaForEmpresaId, createServiceRoleClientForEmpresa } from "@/lib/supabase/empresa-data-schema";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

export type ProyectoPrioridadCodigo = "baja" | "normal" | "alta" | "urgente";

export type ProyectoPrioridadConfigRow = {
  id: string;
  empresa_id: string;
  codigo: ProyectoPrioridadCodigo;
  nombre: string;
  color: string | null;
  bg_color: string | null;
  text_color: string | null;
  border_color: string | null;
  sort_order: number;
  activo: boolean;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ProyectoPrioridadConfigPatch = {
  nombre?: string;
  color?: string | null;
  bg_color?: string | null;
  text_color?: string | null;
  border_color?: string | null;
  sort_order?: number;
  activo?: boolean;
};

export type ProyectoPrioridadesListResult = {
  prioridades: ProyectoPrioridadConfigRow[];
  schema: string;
  source: "db" | "fallback";
};

const PRIORIDAD_COLUMNS =
  "id, empresa_id, codigo, nombre, color, bg_color, text_color, border_color, sort_order, activo, created_at, updated_at";

const PRIORIDAD_CODES = new Set<ProyectoPrioridadCodigo>(["baja", "normal", "alta", "urgente"]);

export const DEFAULT_PROYECTO_PRIORIDADES: Array<
  Omit<ProyectoPrioridadConfigRow, "id" | "empresa_id" | "created_at" | "updated_at">
> = [
  {
    codigo: "baja",
    nombre: "Baja",
    color: "#64748b",
    bg_color: "#f1f5f9",
    text_color: "#475569",
    border_color: "#cbd5e1",
    sort_order: 10,
    activo: true,
  },
  {
    codigo: "normal",
    nombre: "Media",
    color: "#475569",
    bg_color: "#e2e8f0",
    text_color: "#1e293b",
    border_color: "#cbd5e1",
    sort_order: 20,
    activo: true,
  },
  {
    codigo: "alta",
    nombre: "Alta",
    color: "#f97316",
    bg_color: "#f97316",
    text_color: "#ffffff",
    border_color: "#ea580c",
    sort_order: 30,
    activo: true,
  },
  {
    codigo: "urgente",
    nombre: "Urgente",
    color: "#dc2626",
    bg_color: "#dc2626",
    text_color: "#ffffff",
    border_color: "#b91c1c",
    sort_order: 40,
    activo: true,
  },
];

function fallbackRows(empresaId: string): ProyectoPrioridadConfigRow[] {
  return DEFAULT_PROYECTO_PRIORIDADES.map((p) => ({
    id: `fallback-${p.codigo}`,
    empresa_id: empresaId,
    ...p,
  }));
}

function isUndefinedTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const rec = error as { code?: string; message?: string };
  return rec.code === "42P01" || /does not exist|relation .*proyecto_prioridades_config/i.test(rec.message ?? "");
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const s = value.trim();
  return s.length > 0 ? s : undefined;
}

function normalizeNullableColor(value: unknown, field: string): string | null | undefined {
  if (value === null || value === "") return null;
  const s = normalizeString(value);
  if (!s) return undefined;
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) {
    throw new Error(`${field} debe tener formato hexadecimal, por ejemplo #0EA5E9.`);
  }
  return s;
}

function normalizeInteger(value: unknown, field: string): number | undefined {
  if (value === "" || value == null) return undefined;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n)) throw new Error(`${field} debe ser un número entero.`);
  return n;
}

function normalizeBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function parseProyectoPrioridadConfigPatch(body: unknown): ProyectoPrioridadConfigPatch {
  const r = readRecord(body);
  const patch: ProyectoPrioridadConfigPatch = {};

  const nombre = normalizeString(r.nombre);
  if (Object.prototype.hasOwnProperty.call(r, "nombre") && nombre === undefined) {
    throw new Error("El nombre visible es obligatorio.");
  }
  if (nombre !== undefined) patch.nombre = nombre;

  const color = normalizeNullableColor(r.color, "Color");
  if (color !== undefined) patch.color = color;

  const bgColor = normalizeNullableColor(r.bg_color, "Color de fondo");
  if (bgColor !== undefined) patch.bg_color = bgColor;

  const textColor = normalizeNullableColor(r.text_color, "Color de texto");
  if (textColor !== undefined) patch.text_color = textColor;

  const borderColor = normalizeNullableColor(r.border_color, "Color de borde");
  if (borderColor !== undefined) patch.border_color = borderColor;

  const sortOrder = normalizeInteger(r.sort_order, "El orden");
  if (sortOrder !== undefined) patch.sort_order = sortOrder;

  const activo = normalizeBoolean(r.activo);
  if (activo !== undefined) patch.activo = activo;

  return patch;
}

export function ensurePrioridadPatchHasChanges(patch: ProyectoPrioridadConfigPatch): void {
  if (Object.keys(patch).length === 0) {
    throw new Error("No hay cambios para guardar.");
  }
}

async function resolveSchemaAndPool(empresaId: string) {
  const schema = await fetchDataSchemaForEmpresaId(empresaId);
  const pool = getChatPostgresPool();
  return { schema, pool };
}

async function serviceClientForEmpresa(empresaId: string): Promise<AppSupabaseClient> {
  return createServiceRoleClientForEmpresa(empresaId);
}

export async function ensureProyectoPrioridadesConfigRows(empresaId: string): Promise<void> {
  const { schema, pool } = await resolveSchemaAndPool(empresaId);

  if (pool) {
    const table = quoteSchemaTable(schema, "proyecto_prioridades_config");
    for (const p of DEFAULT_PROYECTO_PRIORIDADES) {
      await pool.query(
        `
          INSERT INTO ${table} (
            empresa_id, codigo, nombre, color, bg_color, text_color, border_color, sort_order, activo
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (empresa_id, codigo) DO NOTHING
        `,
        [
          empresaId,
          p.codigo,
          p.nombre,
          p.color,
          p.bg_color,
          p.text_color,
          p.border_color,
          p.sort_order,
          p.activo,
        ]
      );
    }
    return;
  }

  const supabase = await serviceClientForEmpresa(empresaId);
  const { error } = await supabase
    .from("proyecto_prioridades_config")
    .upsert(
      DEFAULT_PROYECTO_PRIORIDADES.map((p) => ({ empresa_id: empresaId, ...p })),
      { onConflict: "empresa_id,codigo", ignoreDuplicates: true }
    );
  if (error && !isUndefinedTableError(error)) throw new Error(error.message);
}

export async function listProyectoPrioridadesConfig(
  empresaId: string,
  options?: { ensureDefaults?: boolean }
): Promise<ProyectoPrioridadesListResult> {
  const { schema, pool } = await resolveSchemaAndPool(empresaId);
  const ensureDefaults = options?.ensureDefaults !== false;

  try {
    if (ensureDefaults) await ensureProyectoPrioridadesConfigRows(empresaId);

    if (pool) {
      const table = quoteSchemaTable(schema, "proyecto_prioridades_config");
      const result = await pool.query(
        `
          SELECT ${PRIORIDAD_COLUMNS}
          FROM ${table}
          WHERE empresa_id = $1
          ORDER BY sort_order ASC, created_at ASC
        `,
        [empresaId]
      );
      return { prioridades: result.rows as ProyectoPrioridadConfigRow[], schema, source: "db" };
    }

    const supabase = await serviceClientForEmpresa(empresaId);
    const { data, error } = await supabase
      .from("proyecto_prioridades_config")
      .select(PRIORIDAD_COLUMNS)
      .eq("empresa_id", empresaId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      if (isUndefinedTableError(error)) {
        return { prioridades: fallbackRows(empresaId), schema, source: "fallback" };
      }
      throw new Error(error.message);
    }

    return { prioridades: (data ?? []) as ProyectoPrioridadConfigRow[], schema, source: "db" };
  } catch (e) {
    if (isUndefinedTableError(e)) {
      return { prioridades: fallbackRows(empresaId), schema, source: "fallback" };
    }
    throw e;
  }
}

export async function updateProyectoPrioridadConfig(
  empresaId: string,
  id: string,
  patch: ProyectoPrioridadConfigPatch
): Promise<ProyectoPrioridadConfigRow | null> {
  const { schema, pool } = await resolveSchemaAndPool(empresaId);

  if (pool) {
    const table = quoteSchemaTable(schema, "proyecto_prioridades_config");
    const entries = Object.entries(patch);
    const sets = entries.map(([key], i) => `"${key}" = $${i + 1}`);
    const params = entries.map(([, value]) => value);
    params.push(empresaId, id);

    const result = await pool.query(
      `
        UPDATE ${table}
        SET ${sets.join(", ")}
        WHERE empresa_id = $${params.length - 1}
          AND id = $${params.length}
        RETURNING ${PRIORIDAD_COLUMNS}
      `,
      params
    );
    return (result.rows[0] as ProyectoPrioridadConfigRow | undefined) ?? null;
  }

  const supabase = await serviceClientForEmpresa(empresaId);
  const { data, error } = await supabase
    .from("proyecto_prioridades_config")
    .update(patch)
    .eq("empresa_id", empresaId)
    .eq("id", id)
    .select(PRIORIDAD_COLUMNS)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as ProyectoPrioridadConfigRow | null) ?? null;
}

export function isProyectoPrioridadCodigo(value: string): value is ProyectoPrioridadCodigo {
  return PRIORIDAD_CODES.has(value as ProyectoPrioridadCodigo);
}
