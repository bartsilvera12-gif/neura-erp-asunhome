import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import type { Proveedor, NuevoProveedorInput, ProveedorCategoria } from "./types";

export async function getProveedores(): Promise<Proveedor[]> {
  try {
    const res = await fetchWithSupabaseSession("/api/proveedores", { cache: "no-store" });
    const json = (await res.json()) as {
      success?: boolean;
      data?: { proveedores?: Proveedor[] };
      error?: string;
    };
    if (!res.ok || !json.success || !json.data?.proveedores) {
      console.error("[proveedores] getProveedores:", json.error ?? res.statusText);
      return [];
    }
    return json.data.proveedores;
  } catch (e) {
    console.error("[proveedores] getProveedores:", e);
    return [];
  }
}

export async function getProveedor(id: string): Promise<Proveedor | null> {
  try {
    const res = await fetchWithSupabaseSession(`/api/proveedores/${encodeURIComponent(id)}`, {
      cache: "no-store",
    });
    const json = (await res.json()) as {
      success?: boolean;
      data?: { proveedor?: Proveedor };
      error?: string;
    };
    if (!res.ok || !json.success || !json.data?.proveedor) {
      return null;
    }
    return json.data.proveedor;
  } catch {
    return null;
  }
}

/** Coincidencia por RUC / identificación (normalizada). */
export async function proveedorExiste(ruc: string): Promise<Proveedor | null> {
  const t = ruc.trim();
  if (!t) return null;
  const todos = await getProveedores();
  const lower = t.toLowerCase();
  return todos.find((p) => (p.ruc ?? "").trim().toLowerCase() === lower) ?? null;
}

export async function createProveedor(datos: NuevoProveedorInput): Promise<{ ok: true; proveedor: Proveedor } | { ok: false; error: string }> {
  try {
    const res = await fetchWithSupabaseSession("/api/proveedores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datos),
    });
    const json = (await res.json()) as {
      success?: boolean;
      data?: { proveedor?: Proveedor };
      error?: string;
    };
    if (!res.ok || !json.success || !json.data?.proveedor) {
      return { ok: false, error: json.error ?? `Error ${res.status}` };
    }
    return { ok: true, proveedor: json.data.proveedor };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error de red." };
  }
}

export async function updateProveedor(
  id: string,
  datos: Partial<NuevoProveedorInput> & { categoria_ids?: string[] }
): Promise<{ ok: true; proveedor: Proveedor } | { ok: false; error: string }> {
  try {
    const res = await fetchWithSupabaseSession(`/api/proveedores/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datos),
    });
    const json = (await res.json()) as {
      success?: boolean;
      data?: { proveedor?: Proveedor };
      error?: string;
    };
    if (!res.ok || !json.success || !json.data?.proveedor) {
      return { ok: false, error: json.error ?? `Error ${res.status}` };
    }
    return { ok: true, proveedor: json.data.proveedor };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error de red." };
  }
}

export async function getCategoriasProveedor(options?: { todas?: boolean }): Promise<ProveedorCategoria[]> {
  const q = options?.todas ? "?todas=1" : "";
  try {
    const res = await fetchWithSupabaseSession(`/api/proveedores/categorias${q}`, { cache: "no-store" });
    const json = (await res.json()) as {
      success?: boolean;
      data?: { categorias?: ProveedorCategoria[] };
      error?: string;
    };
    if (!res.ok || !json.success || !json.data?.categorias) {
      console.error("[proveedores] getCategoriasProveedor:", json.error ?? res.statusText);
      return [];
    }
    return json.data.categorias;
  } catch (e) {
    console.error("[proveedores] getCategoriasProveedor:", e);
    return [];
  }
}

export async function createCategoriaProveedor(input: {
  nombre: string;
  descripcion?: string | null;
  activo?: boolean;
}): Promise<{ ok: true; categoria: ProveedorCategoria } | { ok: false; error: string }> {
  try {
    const res = await fetchWithSupabaseSession("/api/proveedores/categorias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const json = (await res.json()) as {
      success?: boolean;
      data?: { categoria?: ProveedorCategoria };
      error?: string;
    };
    if (!res.ok || !json.success || !json.data?.categoria) {
      return { ok: false, error: json.error ?? `Error ${res.status}` };
    }
    return { ok: true, categoria: json.data.categoria };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error de red." };
  }
}

export async function updateCategoriaProveedor(
  id: string,
  patch: Partial<{ nombre: string; descripcion: string | null; activo: boolean }>
): Promise<{ ok: true; categoria: ProveedorCategoria } | { ok: false; error: string }> {
  try {
    const res = await fetchWithSupabaseSession(`/api/proveedores/categorias/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = (await res.json()) as {
      success?: boolean;
      data?: { categoria?: ProveedorCategoria };
      error?: string;
    };
    if (!res.ok || !json.success || !json.data?.categoria) {
      return { ok: false, error: json.error ?? `Error ${res.status}` };
    }
    return { ok: true, categoria: json.data.categoria };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error de red." };
  }
}
