import { createBrowserClient } from "@supabase/ssr";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { supabaseDbSchemaOption } from "@/lib/supabase/schema";

export interface Empresa {
  id: string;
  nombre_empresa: string;
  plan: string | null;
  ruc: string | null;
  estado: string;
  created_at: string;
}

export interface Modulo {
  id: string;
  nombre?: string;
  name?: string;
}

export interface ModuloEmpresa {
  id: string;
  nombre: string;
  slug: string;
}

export async function getModulosEmpresa(empresaId: string): Promise<ModuloEmpresa[]> {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { ...supabaseDbSchemaOption }
  );
  const { data: emData, error: err1 } = await supabase
    .from("empresa_modulos")
    .select("modulo_id")
    .eq("empresa_id", empresaId)
    .eq("activo", true);

  if (err1) throw new Error(err1.message);
  const moduloIds = (emData ?? []).map((r) => r.modulo_id).filter(Boolean);
  if (moduloIds.length === 0) return [];

  const { data: modulos, error: err2 } = await supabase
    .from("modulos")
    .select("id, nombre, slug")
    .in("id", moduloIds);

  if (err2) throw new Error(err2.message);
  return (modulos ?? []).map((m) => ({
    id: m.id,
    nombre: m.nombre ?? "",
    slug: m.slug ?? "",
  }));
}

/** Obtiene los módulos habilitados para la empresa del usuario autenticado (vía API con service role). */
export async function getMisModulos(): Promise<ModuloEmpresa[]> {
  const res = await fetchWithSupabaseSession("/api/empresas/mis-modulos", { cache: "no-store" });
  if (!res.ok) {
    if (res.status === 401) return [];
    throw new Error("Error al cargar módulos");
  }
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) {
    console.error("[getMisModulos] respuesta no es un array:", data);
    throw new Error("Respuesta inválida del servidor al cargar módulos.");
  }
  return data as ModuloEmpresa[];
}

/** Obtiene todos los módulos de la tabla modulos (para super_admin). */
export async function getTodosModulos(): Promise<ModuloEmpresa[]> {
  const res = await fetchWithSupabaseSession("/api/admin/modulos", { cache: "no-store" });
  if (!res.ok) throw new Error("Error al cargar módulos");
  const data = await res.json();
  return (data ?? []).map((m: { id: string; nombre?: string; slug?: string }) => ({
    id: m.id,
    nombre: m.nombre ?? "",
    slug: m.slug ?? "",
  }));
}

export async function getEmpresas(): Promise<Empresa[]> {
  const res = await fetchWithSupabaseSession("/api/admin/empresas");
  if (!res.ok) throw new Error("Error al cargar empresas");
  return res.json();
}

/** Solo super_admin (vía API). Borra empresa, schema tenant y usuarios de Auth vinculados. */
export async function eliminarEmpresa(empresaId: string): Promise<void> {
  const res = await fetchWithSupabaseSession(`/api/admin/empresas/${empresaId}`, {
    method: "DELETE",
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new Error(typeof json.error === "string" ? json.error : "No se pudo eliminar la empresa");
  }
}

export async function getModulos(): Promise<Modulo[]> {
  const res = await fetchWithSupabaseSession("/api/admin/modulos");
  if (!res.ok) throw new Error("Error al cargar módulos");
  return res.json();
}

export type DashboardViewCatalog = { id: string; nombre: string; slug: string; orden: number; activo?: boolean };

export async function getDashboardViewsCatalog(): Promise<DashboardViewCatalog[]> {
  const res = await fetchWithSupabaseSession("/api/admin/dashboard-views", { cache: "no-store" });
  if (!res.ok) throw new Error("Error al cargar vistas de dashboard");
  return res.json();
}

export interface CrearEmpresaData {
  nombre_empresa: string;
  plan?: string;
  ruc: string;
  estado: string;
  email: string;
  password: string;
  nombre: string;
  modulo_ids: string[];
  /** Vistas de tablero habilitadas; vacío = todas las del catálogo. */
  dashboard_view_ids?: string[];
  /** Opcional: fragmento para nombre de schema (erp_<slug>_<8hex>); si no se envía se usa nombre_empresa. */
  schema_slug?: string;
}

export async function crearEmpresa(data: CrearEmpresaData): Promise<{ empresa_id: string }> {
  const res = await fetchWithSupabaseSession("/api/admin/crear-empresa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(
      typeof json.error === "string" ? json.error : json.error?.message || "Error creando empresa"
    );
  }
  return json;
}

export interface UsuarioEmpresa {
  id: string;
  nombre: string;
  email: string;
  rol: string;
  estado?: string;
  created_at: string;
  modulo_ids?: string[];
  dashboard_view_ids?: string[];
}

export interface EmpresaDetalle {
  empresa: Empresa;
  usuarios: UsuarioEmpresa[];
  modulos: { id: string; nombre: string; slug: string }[];
  dashboard_views?: { id: string; nombre: string; slug: string; orden: number }[];
  dashboard_view_ids?: string[];
}

export async function getEmpresaById(id: string): Promise<EmpresaDetalle> {
  const res = await fetchWithSupabaseSession(`/api/admin/empresas/${id}`, { cache: "no-store" });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(typeof json.error === "string" ? json.error : "Empresa no encontrada");
  }
  return json;
}

export interface ActualizarEmpresaData {
  nombre_empresa?: string;
  ruc?: string;
  plan?: string;
  estado?: string;
  modulo_ids?: string[];
  dashboard_view_ids?: string[];
}

export async function actualizarEmpresa(id: string, data: ActualizarEmpresaData): Promise<void> {
  const res = await fetchWithSupabaseSession(`/api/admin/empresas/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(
      typeof json.error === "string" ? json.error : json.error?.message || "Error actualizando empresa"
    );
  }
}

export interface ActualizarUsuarioData {
  nombre?: string;
  email?: string;
  estado?: "activo" | "inactivo";
  modulo_ids?: string[];
  dashboard_view_ids?: string[];
  default_dashboard_view_id?: string | null;
}

export async function actualizarUsuario(id: string, data: ActualizarUsuarioData): Promise<void> {
  const res = await fetchWithSupabaseSession(`/api/admin/usuarios/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(
      typeof json.error === "string" ? json.error : json.error?.message || "Error actualizando usuario"
    );
  }
}

export async function resetearPasswordUsuario(id: string, password: string): Promise<void> {
  const res = await fetchWithSupabaseSession(`/api/admin/usuarios/${id}/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(
      typeof json.error === "string" ? json.error : json.error?.message || "Error reseteando contraseña"
    );
  }
}
