import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { getBrowserSupabaseForEmpresaData } from "@/lib/supabase/browser-data-client";
import type { Plan, EstadoPlan, PlanMarketingPlantilla } from "./types";

// ─── Tipos de fila Supabase ───────────────────────────────────────────────────

interface PlanRow {
  id: string;
  empresa_id: string;
  codigo_plan: string;
  nombre: string;
  descripcion: string | null;
  precio: number;
  moneda: string;
  periodicidad: string;
  limite_usuarios: number | null;
  limite_clientes: number | null;
  limite_facturas: number | null;
  estado: string;
  es_plan_marketing: boolean | null;
  plantilla_operativa: unknown;
  created_at: string;
  updated_at: string;
}

// ─── Mapeo fila → tipo ────────────────────────────────────────────────────────

function rowToPlan(row: PlanRow): Plan {
  const plantilla = row.plantilla_operativa;
  return {
    id: row.id,
    codigo_plan: row.codigo_plan,
    nombre: row.nombre,
    descripcion: row.descripcion ?? undefined,
    precio: Number(row.precio),
    moneda: row.moneda as Plan["moneda"],
    periodicidad: row.periodicidad as Plan["periodicidad"],
    limite_usuarios: row.limite_usuarios,
    limite_clientes: row.limite_clientes,
    limite_facturas: row.limite_facturas,
    estado: row.estado as EstadoPlan,
    es_plan_marketing: Boolean(row.es_plan_marketing),
    plantilla_operativa: Array.isArray((plantilla as { items?: unknown })?.items)
      ? (plantilla as PlanMarketingPlantilla)
      : undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ─── API pública ──────────────────────────────────────────────────────────────

/** Lista planes del tenant (API + service role; evita RLS del navegador). */
export async function getPlanes(): Promise<Plan[]> {
  if (typeof window !== "undefined") {
    try {
      const res = await fetchWithSupabaseSession("/api/planes", { cache: "no-store" });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        console.error("[planes] getPlanes API:", res.status, t);
        return [];
      }
      const json = (await res.json()) as { success?: boolean; data?: PlanRow[] };
      if (!json.success || !Array.isArray(json.data)) return [];
      return json.data.map(rowToPlan);
    } catch (e) {
      console.error("[planes] getPlanes:", e);
      return [];
    }
  }

  const supabase = await getBrowserSupabaseForEmpresaData();
  const { data, error } = await supabase
    .from("planes")
    .select("*")
    .order("codigo_plan");

  if (error) {
    console.error("[planes] getPlanes:", error.message);
    return [];
  }
  return (data as PlanRow[]).map(rowToPlan);
}

/** Obtiene un plan por ID (API tenant + service role en el navegador). */
export async function getPlan(id: string): Promise<Plan | null> {
  if (typeof window !== "undefined") {
    try {
      const res = await fetchWithSupabaseSession(`/api/planes/${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      if (res.status === 404) return null;
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        console.error("[planes] getPlan API:", res.status, t);
        return null;
      }
      const json = (await res.json()) as { success?: boolean; data?: PlanRow };
      if (!json.success || !json.data) return null;
      return rowToPlan(json.data as PlanRow);
    } catch (e) {
      console.error("[planes] getPlan:", e);
      return null;
    }
  }

  const supabase = await getBrowserSupabaseForEmpresaData();
  const { data, error } = await supabase.from("planes").select("*").eq("id", id).single();

  if (error) {
    console.error("[planes] getPlan:", error.message);
    return null;
  }
  return rowToPlan(data as PlanRow);
}

export type NuevoPlanData = Omit<Plan, "id" | "codigo_plan" | "created_at" | "updated_at">;

export type PlanGuardadoOk = { ok: true; plan: Plan };
export type PlanGuardadoErr = { ok: false; error: string };

/** Crea plan vía API tenant (service role); evita INSERT bloqueado por RLS en el navegador. */
export async function savePlan(datos: NuevoPlanData): Promise<PlanGuardadoOk | PlanGuardadoErr> {
  if (typeof window === "undefined") {
    return { ok: false, error: "Operación no disponible fuera del navegador." };
  }
  try {
    const res = await fetchWithSupabaseSession("/api/planes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nombre: datos.nombre,
        descripcion: datos.descripcion,
        precio: datos.precio,
        moneda: datos.moneda,
        periodicidad: datos.periodicidad,
        limite_usuarios: datos.limite_usuarios,
        limite_clientes: datos.limite_clientes,
        limite_facturas: datos.limite_facturas,
        estado: datos.estado,
        es_plan_marketing: datos.es_plan_marketing,
        plantilla_operativa: datos.plantilla_operativa,
      }),
    });
    const json = (await res.json()) as { success?: boolean; data?: PlanRow; error?: string };
    if (!res.ok || json.success !== true || !json.data) {
      return { ok: false, error: json.error ?? `No se pudo crear el plan (${res.status}).` };
    }
    return { ok: true, plan: rowToPlan(json.data as PlanRow) };
  } catch (e) {
    console.error("[planes] savePlan:", e);
    return { ok: false, error: e instanceof Error ? e.message : "Error de red." };
  }
}

/** Actualiza plan vía API tenant. */
export async function updatePlan(
  id: string,
  datos: Partial<Omit<Plan, "id" | "codigo_plan" | "created_at">>
): Promise<PlanGuardadoOk | PlanGuardadoErr> {
  if (typeof window === "undefined") {
    return { ok: false, error: "Operación no disponible fuera del navegador." };
  }
  const body: Record<string, unknown> = {};
  if (datos.nombre !== undefined) body.nombre = datos.nombre;
  if (datos.descripcion !== undefined) body.descripcion = datos.descripcion ?? null;
  if (datos.precio !== undefined) body.precio = datos.precio;
  if (datos.moneda !== undefined) body.moneda = datos.moneda;
  if (datos.periodicidad !== undefined) body.periodicidad = datos.periodicidad;
  if (datos.limite_usuarios !== undefined) body.limite_usuarios = datos.limite_usuarios ?? null;
  if (datos.limite_clientes !== undefined) body.limite_clientes = datos.limite_clientes ?? null;
  if (datos.limite_facturas !== undefined) body.limite_facturas = datos.limite_facturas ?? null;
  if (datos.estado !== undefined) body.estado = datos.estado;
  if (datos.es_plan_marketing !== undefined) body.es_plan_marketing = datos.es_plan_marketing;
  if (datos.plantilla_operativa !== undefined) body.plantilla_operativa = datos.plantilla_operativa;

  try {
    const res = await fetchWithSupabaseSession(`/api/planes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { success?: boolean; data?: PlanRow; error?: string };
    if (!res.ok || json.success !== true || !json.data) {
      return { ok: false, error: json.error ?? `No se pudo actualizar el plan (${res.status}).` };
    }
    return { ok: true, plan: rowToPlan(json.data as PlanRow) };
  } catch (e) {
    console.error("[planes] updatePlan:", e);
    return { ok: false, error: e instanceof Error ? e.message : "Error de red." };
  }
}

/** Cambia el estado del plan. */
export async function toggleEstadoPlan(id: string, estado: EstadoPlan): Promise<boolean> {
  const r = await updatePlan(id, { estado });
  return r.ok;
}

/** Elimina un plan vía API tenant. */
export async function deletePlan(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (typeof window === "undefined") {
    return { ok: false, error: "Operación no disponible fuera del navegador." };
  }
  try {
    const res = await fetchWithSupabaseSession(`/api/planes/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    const json = (await res.json()) as { success?: boolean; error?: string };
    if (!res.ok || json.success !== true) {
      return { ok: false, error: json.error ?? `No se pudo eliminar (${res.status}).` };
    }
    return { ok: true };
  } catch (e) {
    console.error("[planes] deletePlan:", e);
    return { ok: false, error: e instanceof Error ? e.message : "Error de red." };
  }
}

export function planNombre(p: Plan): string {
  return p.nombre;
}
