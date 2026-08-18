import "server-only";

import type { AppSupabaseClient } from "@/lib/supabase/schema";

export type ProyectoTipoSla = "interno" | "cliente" | "pausado" | "final";

export type ProyectoEstadoConfigRow = {
  id: string;
  empresa_id: string;
  codigo: string;
  nombre: string;
  color: string;
  sort_order: number;
  activo: boolean;
  es_estado_inicial: boolean;
  es_estado_final: boolean;
  cuenta_sla: boolean;
  tipo_sla: ProyectoTipoSla;
  sla_horas_objetivo: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ProyectoEstadoConfigItem = ProyectoEstadoConfigRow & {
  proyectos_activos_count: number;
};

export type ProyectoEstadoConfigPatch = {
  nombre?: string;
  color?: string;
  sort_order?: number;
  activo?: boolean;
  es_estado_inicial?: boolean;
  es_estado_final?: boolean;
  cuenta_sla?: boolean;
  tipo_sla?: ProyectoTipoSla;
  sla_horas_objetivo?: number | null;
};

export type ProyectoEstadoConfigCreate = ProyectoEstadoConfigPatch & {
  codigo: string;
  nombre: string;
};

const ESTADO_COLUMNS =
  "id, empresa_id, codigo, nombre, color, sort_order, activo, es_estado_inicial, es_estado_final, cuenta_sla, tipo_sla, sla_horas_objetivo, created_at, updated_at";

const TIPO_SLA_VALUES = new Set<ProyectoTipoSla>(["interno", "cliente", "pausado", "final"]);

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const s = value.trim();
  return s.length > 0 ? s : undefined;
}

function normalizeCodigo(value: unknown): string | undefined {
  const s = normalizeString(value);
  if (!s) return undefined;
  if (!/^[a-z0-9_]+$/i.test(s)) {
    throw new Error("El código solo puede contener letras, números y guion bajo.");
  }
  return s;
}

function normalizeColor(value: unknown): string | undefined {
  const s = normalizeString(value);
  if (!s) return undefined;
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) {
    throw new Error("El color debe tener formato hexadecimal, por ejemplo #0EA5E9.");
  }
  return s;
}

function normalizeBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function normalizeInteger(value: unknown, field: string): number | undefined {
  if (value === "" || value == null) return undefined;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n)) throw new Error(`${field} debe ser un número entero.`);
  return n;
}

function normalizeNullablePositiveInteger(value: unknown, field: string): number | null | undefined {
  if (value === "" || value == null) return null;
  const n = normalizeInteger(value, field);
  if (n == null) return n;
  if (n < 0) throw new Error(`${field} no puede ser negativo.`);
  return n;
}

function normalizeTipoSla(value: unknown): ProyectoTipoSla | undefined {
  const s = normalizeString(value);
  if (!s) return undefined;
  if (!TIPO_SLA_VALUES.has(s as ProyectoTipoSla)) {
    throw new Error("Tipo de SLA inválido.");
  }
  return s as ProyectoTipoSla;
}

export function parseProyectoEstadoConfigPatch(body: unknown): ProyectoEstadoConfigPatch {
  const r = readRecord(body);
  const patch: ProyectoEstadoConfigPatch = {};

  const nombre = normalizeString(r.nombre);
  if (Object.prototype.hasOwnProperty.call(r, "nombre") && nombre === undefined) {
    throw new Error("El nombre es obligatorio.");
  }
  if (nombre !== undefined) patch.nombre = nombre;

  const color = normalizeColor(r.color);
  if (Object.prototype.hasOwnProperty.call(r, "color") && color === undefined) {
    throw new Error("El color es obligatorio.");
  }
  if (color !== undefined) patch.color = color;

  const sortOrder = normalizeInteger(r.sort_order, "El orden");
  if (sortOrder !== undefined) patch.sort_order = sortOrder;

  const activo = normalizeBoolean(r.activo);
  if (activo !== undefined) patch.activo = activo;

  const esInicial = normalizeBoolean(r.es_estado_inicial);
  if (esInicial !== undefined) patch.es_estado_inicial = esInicial;

  const esFinal = normalizeBoolean(r.es_estado_final);
  if (esFinal !== undefined) patch.es_estado_final = esFinal;

  const cuentaSla = normalizeBoolean(r.cuenta_sla);
  if (cuentaSla !== undefined) patch.cuenta_sla = cuentaSla;

  const tipoSla = normalizeTipoSla(r.tipo_sla);
  if (Object.prototype.hasOwnProperty.call(r, "tipo_sla") && tipoSla === undefined) {
    throw new Error("Tipo de SLA inválido.");
  }
  if (tipoSla !== undefined) patch.tipo_sla = tipoSla;

  const slaHoras = normalizeNullablePositiveInteger(r.sla_horas_objetivo, "Horas SLA");
  if (slaHoras !== undefined) patch.sla_horas_objetivo = slaHoras;

  return patch;
}

export function parseProyectoEstadoConfigCreate(body: unknown): ProyectoEstadoConfigCreate {
  const r = readRecord(body);
  const codigo = normalizeCodigo(r.codigo);
  const nombre = normalizeString(r.nombre);
  if (!codigo) throw new Error("El código es obligatorio para crear una columna.");
  if (!nombre) throw new Error("El nombre es obligatorio.");

  const patch = parseProyectoEstadoConfigPatch(body);
  return {
    ...patch,
    codigo,
    nombre,
    color: patch.color ?? "#64748b",
    sort_order: patch.sort_order ?? 0,
    activo: patch.activo ?? true,
    es_estado_inicial: patch.es_estado_inicial ?? false,
    es_estado_final: patch.es_estado_final ?? false,
    cuenta_sla: patch.cuenta_sla ?? true,
    tipo_sla: patch.tipo_sla ?? "interno",
    sla_horas_objetivo: patch.sla_horas_objetivo ?? null,
  };
}

export async function listProyectoEstadosConfig(
  supabase: AppSupabaseClient,
  empresaId: string
): Promise<ProyectoEstadoConfigItem[]> {
  const { data, error } = await supabase
    .from("proyecto_estados")
    .select(ESTADO_COLUMNS)
    .eq("empresa_id", empresaId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);

  const estados = (data ?? []) as ProyectoEstadoConfigRow[];
  const withCounts = await Promise.all(
    estados.map(async (estado) => ({
      ...estado,
      proyectos_activos_count: await countActiveProjectsForEstado(supabase, empresaId, estado.id),
    }))
  );

  return withCounts;
}

export async function getProyectoEstadoConfigById(
  supabase: AppSupabaseClient,
  empresaId: string,
  id: string
): Promise<ProyectoEstadoConfigRow | null> {
  const { data, error } = await supabase
    .from("proyecto_estados")
    .select(ESTADO_COLUMNS)
    .eq("empresa_id", empresaId)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as ProyectoEstadoConfigRow | null) ?? null;
}

export async function countActiveProjectsForEstado(
  supabase: AppSupabaseClient,
  empresaId: string,
  estadoId: string
): Promise<number> {
  const { data, error } = await supabase
    .from("proyectos")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("estado_id", estadoId)
    .eq("archivado", false);

  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data.length : 0;
}

export function ensurePatchHasChanges(patch: ProyectoEstadoConfigPatch): void {
  if (Object.keys(patch).length === 0) {
    throw new Error("No hay cambios para guardar.");
  }
}

export function validateEstadoFunctionalRules(
  estados: ProyectoEstadoConfigRow[],
  targetId: string | null,
  next: Pick<ProyectoEstadoConfigRow, "id" | "activo" | "es_estado_inicial">
): void {
  if (next.es_estado_inicial && !next.activo) {
    throw new Error("Una columna inicial debe estar activa.");
  }

  const existingInitialCount = estados.reduce((count, estado) => {
    const isTarget = targetId != null && estado.id === targetId;
    const activo = isTarget ? next.activo : estado.activo;
    const inicial = isTarget ? next.es_estado_inicial : estado.es_estado_inicial;
    return activo && inicial ? count + 1 : count;
  }, 0);
  const activeInitialCount =
    targetId == null && next.activo && next.es_estado_inicial
      ? existingInitialCount + 1
      : existingInitialCount;

  if (activeInitialCount === 0) {
    throw new Error("Debe existir al menos una columna inicial activa.");
  }

  if (activeInitialCount > 1) {
    throw new Error("No puede haber más de una columna inicial activa.");
  }
}
