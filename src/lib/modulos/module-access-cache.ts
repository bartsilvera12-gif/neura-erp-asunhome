/**
 * Cache de /api/empresas/module-access en sessionStorage.
 *
 * Problema: AuthGuard y Sidebar piden este endpoint en paralelo, y cada
 * onAuthStateChange de Supabase (token refresh) vuelve a llamarlo. Resultado:
 * 4+ requests por navegación, cada una ~1-2 segundos = 8 segundos perdidos
 * antes de que la pantalla muestre contenido.
 *
 * Solución: cache en sessionStorage (no localStorage para que se borre al
 * cerrar la pestaña). TTL de 10 minutos por si los permisos cambian del
 * lado del admin mientras el usuario está logueado.
 *
 * Invalidación: además del TTL, se borra al logout (lo hace signOut() si
 * limpia sessionStorage) y al cambiar de usuario.
 */
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

const CACHE_KEY = "neura.moduleAccess.v1";
const TTL_MS = 10 * 60 * 1000; // 10 minutos

export type ModuleAccessResponse = {
  superAdmin?: boolean;
  slugs?: string[];
  inactiveSlugs?: string[];
  strictAllowlist?: boolean;
  modulos?: Array<{ id: string; nombre: string; slug: string }>;
};

type CachedEntry = {
  data: ModuleAccessResponse;
  expiresAt: number;
};

function readCache(): ModuleAccessResponse | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedEntry;
    if (!parsed || typeof parsed.expiresAt !== "number") return null;
    if (Date.now() > parsed.expiresAt) {
      window.sessionStorage.removeItem(CACHE_KEY);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCache(data: ModuleAccessResponse): void {
  if (typeof window === "undefined") return;
  try {
    const entry: CachedEntry = { data, expiresAt: Date.now() + TTL_MS };
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    /* sessionStorage lleno o deshabilitado; degradar silenciosamente */
  }
}

export function clearModuleAccessCache(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(CACHE_KEY);
  } catch {
    /* nop */
  }
}

/**
 * Devuelve module-access cacheado o lo fetcha del server.
 * Si `forceRefresh` es true, ignora el cache y vuelve al server.
 */
export async function getModuleAccessCached(opts?: {
  forceRefresh?: boolean;
}): Promise<{ ok: boolean; data: ModuleAccessResponse }> {
  if (!opts?.forceRefresh) {
    const cached = readCache();
    if (cached) return { ok: true, data: cached };
  }

  try {
    const res = await fetchWithSupabaseSession("/api/empresas/module-access", {
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, data: {} };
    }
    const data = (await res.json()) as ModuleAccessResponse;
    writeCache(data);
    return { ok: true, data };
  } catch {
    return { ok: false, data: {} };
  }
}
