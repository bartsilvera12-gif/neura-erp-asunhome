import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

export interface UsuarioEmpresa {
  id: string;
  nombre: string | null;
  email: string;
  rol: string | null;
  estado: string | null;
}

type UsuariosEmpresaResponse = {
  usuarios?: unknown;
  error?: string;
};

/** Lista usuarios activos de la empresa del usuario actual vía API server-side. */
export async function getUsuariosActivosEmpresa(): Promise<UsuarioEmpresa[]> {
  const res = await fetchWithSupabaseSession("/api/usuarios/empresa-activos", {
    cache: "no-store",
  });

  let json: UsuariosEmpresaResponse;
  try {
    json = (await res.json()) as UsuariosEmpresaResponse;
  } catch {
    throw new Error("Respuesta inválida al cargar usuarios activos.");
  }

  if (!res.ok) {
    throw new Error(json.error ?? `Error ${res.status} al cargar usuarios activos.`);
  }

  if (!Array.isArray(json.usuarios)) {
    throw new Error(json.error ?? "Respuesta inválida al cargar usuarios activos.");
  }

  return json.usuarios
    .filter((r): r is Record<string, unknown> => r != null && typeof r === "object")
    .map((r) => ({
      id: typeof r.id === "string" ? r.id : "",
      nombre: typeof r.nombre === "string" ? r.nombre : null,
      email: typeof r.email === "string" ? r.email : "",
      rol: typeof r.rol === "string" ? r.rol : null,
      estado: typeof r.estado === "string" ? r.estado : null,
    }))
    .filter((u) => u.id.trim() !== "");
}
