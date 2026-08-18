/**
 * Etapas CRM: lectura/escritura vía `crm_etapas`. Configuración es la UI de administración;
 * el Kanban y el resumen del dashboard leen con GET /api/crm/etapas (misma fuente).
 */
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { getBrowserSupabaseForEmpresaData } from "@/lib/supabase/browser-data-client";
import { getCurrentUser } from "@/lib/auth";

export interface EtapaCrm {
  id:         string;
  empresa_id: string;
  codigo:     string;
  nombre:     string;
  color:      string;
  orden:      number;
  activo:     boolean;
  created_at: string;
  updated_at: string;
}

/** Igualdad estable Kanban vs `crm_prospectos.etapa` (trim + mayúsculas). */
export function normalizeEtapaCodigo(c: string | undefined | null): string {
  return String(c ?? "").trim().toUpperCase();
}

interface EtapaRow {
  id: string;
  empresa_id: string;
  codigo: string;
  nombre: string;
  color: string;
  orden: number;
  activo: boolean;
  created_at: string;
  updated_at: string;
}

function rowToEtapa(row: EtapaRow): EtapaCrm {
  return {
    id: row.id,
    empresa_id: row.empresa_id,
    codigo: row.codigo,
    nombre: row.nombre,
    color: row.color,
    orden: row.orden,
    activo: row.activo,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Lista etapas activas de la empresa del usuario. Ordenadas por orden. */
export async function getEtapas(): Promise<EtapaCrm[]> {
  if (typeof window !== "undefined") {
    try {
      const res = await fetchWithSupabaseSession("/api/crm/etapas", { cache: "no-store" });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        console.error("[crm] getEtapas API:", res.status, t);
        return [];
      }
      const json = (await res.json()) as { success?: boolean; data?: EtapaRow[] };
      if (!json.success || !Array.isArray(json.data)) return [];
      return json.data.map(rowToEtapa);
    } catch (e) {
      console.error("[crm] getEtapas:", e);
      return [];
    }
  }

  const usuario = await getCurrentUser();
  if (!usuario?.empresa_id) return [];

  const supabase = await getBrowserSupabaseForEmpresaData();
  const { data, error } = await supabase
    .from("crm_etapas")
    .select("*")
    .eq("empresa_id", usuario.empresa_id)
    .eq("activo", true)
    .order("orden", { ascending: true });

  if (error) {
    console.error("[crm] getEtapas:", error.message);
    return [];
  }
  return (data as EtapaRow[]).map(rowToEtapa);
}

/**
 * Lista todas las etapas (incluidas inactivas) para configuración.
 * Usa el mismo origen que el Kanban: GET /api/crm/etapas?config=1 (service role + PG en tenants no expuestos a PostgREST).
 * El acceso directo con anon+RLS devolvía [] aunque el board mostrara columnas.
 */
export async function getEtapasParaConfig(): Promise<EtapaCrm[]> {
  if (typeof window !== "undefined") {
    try {
      const res = await fetchWithSupabaseSession("/api/crm/etapas?config=1", { cache: "no-store" });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        console.error("[crm] getEtapasParaConfig API:", res.status, t);
        return fallBackEtapasConfigDesdeBrowser();
      }
      const json = (await res.json()) as { success?: boolean; data?: EtapaRow[] };
      if (json?.success && Array.isArray(json.data)) {
        return json.data.map(rowToEtapa);
      }
      return fallBackEtapasConfigDesdeBrowser();
    } catch (e) {
      console.error("[crm] getEtapasParaConfig:", e);
      return fallBackEtapasConfigDesdeBrowser();
    }
  }

  const usuario = await getCurrentUser();
  if (!usuario?.empresa_id) return [];
  const supabase = await getBrowserSupabaseForEmpresaData();
  const { data, error } = await supabase
    .from("crm_etapas")
    .select("*")
    .eq("empresa_id", usuario.empresa_id)
    .order("orden", { ascending: true });
  if (error) {
    console.error("[crm] getEtapasParaConfig:", error.message);
    return [];
  }
  return (data as EtapaRow[]).map(rowToEtapa);
}

/** Último recurso si la API falla (misma lógica previa). */
async function fallBackEtapasConfigDesdeBrowser(): Promise<EtapaCrm[]> {
  const usuario = await getCurrentUser();
  if (!usuario?.empresa_id) return [];
  try {
    const supabase = await getBrowserSupabaseForEmpresaData();
    const { data, error } = await supabase
      .from("crm_etapas")
      .select("*")
      .eq("empresa_id", usuario.empresa_id)
      .order("orden", { ascending: true });
    if (error) {
      console.error("[crm] getEtapasParaConfig fallback:", error.message);
      return [];
    }
    return (data as EtapaRow[]).map(rowToEtapa);
  } catch (e) {
    console.error("[crm] getEtapasParaConfig fallback:", e);
    return [];
  }
}

/** Crea etapa. Solo admin. En el navegador va por API (misma resolución tenant/RLS que el Kanban). */
export async function createEtapa(datos: {
  codigo: string;
  nombre: string;
  color: string;
  orden: number;
}): Promise<EtapaCrm | null> {
  if (typeof window !== "undefined") {
    const res = await fetchWithSupabaseSession("/api/crm/etapas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        codigo: datos.codigo.trim().toUpperCase().replace(/\s+/g, "_"),
        nombre: datos.nombre.trim(),
        color: datos.color || "gray",
        orden: datos.orden,
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.error("[crm] createEtapa API:", res.status, t);
      return null;
    }
    const json = (await res.json()) as { success?: boolean; data?: EtapaRow };
    if (json?.success && json.data) return rowToEtapa(json.data as EtapaRow);
    return null;
  }

  const usuario = await getCurrentUser();
  if (!usuario?.empresa_id) throw new Error("Usuario no autenticado o sin empresa");
  const insert = {
    empresa_id: usuario.empresa_id,
    codigo: datos.codigo.trim().toUpperCase().replace(/\s+/g, "_"),
    nombre: datos.nombre.trim(),
    color: datos.color || "gray",
    orden: datos.orden,
    activo: true,
  };
  const supabase = await getBrowserSupabaseForEmpresaData();
  const { data, error } = await supabase.from("crm_etapas").insert([insert]).select().single();
  if (error) {
    console.error("[crm] createEtapa:", error.message);
    return null;
  }
  return rowToEtapa(data as EtapaRow);
}

/** Actualiza etapa. En el navegador: PUT /api/crm/etapas/:id */
export async function updateEtapa(
  id: string,
  datos: Partial<Pick<EtapaCrm, "nombre" | "color" | "orden" | "activo">>
): Promise<EtapaCrm | null> {
  const patch: Record<string, unknown> = {};
  if (datos.nombre !== undefined) patch.nombre = datos.nombre.trim();
  if (datos.color !== undefined) patch.color = datos.color;
  if (datos.orden !== undefined) patch.orden = datos.orden;
  if (datos.activo !== undefined) patch.activo = datos.activo;
  if (Object.keys(patch).length === 0) return null;

  if (typeof window !== "undefined") {
    const res = await fetchWithSupabaseSession(`/api/crm/etapas/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.error("[crm] updateEtapa API:", res.status, t);
      return null;
    }
    const json = (await res.json()) as { success?: boolean; data?: EtapaRow };
    if (json?.success && json.data) return rowToEtapa(json.data as EtapaRow);
    return null;
  }

  const supabase = await getBrowserSupabaseForEmpresaData();
  const { data, error } = await supabase.from("crm_etapas").update(patch).eq("id", id).select().single();
  if (error) {
    console.error("[crm] updateEtapa:", error.message);
    return null;
  }
  return rowToEtapa(data as EtapaRow);
}

/** Elimina etapa. En el navegador: DELETE /api/crm/etapas/:id */
export async function deleteEtapa(id: string): Promise<boolean> {
  if (typeof window !== "undefined") {
    const res = await fetchWithSupabaseSession(`/api/crm/etapas/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.error("[crm] deleteEtapa API:", res.status, t);
      return false;
    }
    const json = (await res.json().catch(() => ({}))) as { success?: boolean };
    return Boolean(json?.success);
  }
  const supabase = await getBrowserSupabaseForEmpresaData();
  const { error } = await supabase.from("crm_etapas").delete().eq("id", id);
  if (error) {
    console.error("[crm] deleteEtapa:", error.message);
    return false;
  }
  return true;
}

/** Mapeo color -> clases Tailwind para el Kanban. */
export const COLOR_TO_CLASSES: Record<string, { headerBg: string; headerText: string; border: string; dot: string }> = {
  gray:   { headerBg: "bg-gray-100",   headerText: "text-gray-700",   border: "border-gray-200",   dot: "bg-gray-400"   },
  blue:   { headerBg: "bg-blue-50",     headerText: "text-blue-700",   border: "border-blue-200",   dot: "bg-blue-500"   },
  amber:  { headerBg: "bg-amber-50",   headerText: "text-amber-700",  border: "border-amber-200",  dot: "bg-amber-500"  },
  green:  { headerBg: "bg-green-50",   headerText: "text-green-700",  border: "border-green-200",  dot: "bg-green-500"  },
  red:    { headerBg: "bg-red-50",     headerText: "text-red-700",    border: "border-red-200",    dot: "bg-red-400"    },
  violet: { headerBg: "bg-violet-50",  headerText: "text-violet-700", border: "border-violet-200", dot: "bg-violet-500" },
  cyan:   { headerBg: "bg-cyan-50",   headerText: "text-cyan-700",   border: "border-cyan-200",   dot: "bg-cyan-500"   },
  pink:   { headerBg: "bg-pink-50",   headerText: "text-pink-700",   border: "border-pink-200",   dot: "bg-pink-500"   },
};

export function getEtapaClasses(color: string) {
  return COLOR_TO_CLASSES[color] ?? COLOR_TO_CLASSES.gray;
}
