/**
 * Cache de /api/empresas/module-access en localStorage.
 *
 * Problema 1: AuthGuard y Sidebar piden este endpoint en paralelo, y cada
 * onAuthStateChange de Supabase (token refresh) vuelve a llamarlo. Resultado:
 * 4+ requests por navegación, cada una ~1-2 segundos = 8 segundos perdidos
 * antes de que la pantalla muestre contenido.
 *
 * Problema 2 (UX): al volver a la pestaña tras tenerla en background, Chrome
 * puede descartar/congelar la página (tab discarding) — al remontar React, el
 * Sidebar arrancaba en estado "Cargando…" porque `useState(true)` se reinicia
 * y sessionStorage NO siempre sobrevive al discard. Con localStorage + peek
 * sincrónico, el Sidebar se hidrata sin flash de loader.
 *
 * Solución:
 *   - localStorage con TTL de 10 minutos.
 *   - peekModuleAccessCache(): lectura síncrona para hidratar useState inicial.
 *   - Invalidación: signOut() llama clearModuleAccessCache(); SIGNED_IN
 *     llama getModuleAccessCached({ forceRefresh: true }) por si cambió user.
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
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedEntry;
    if (!parsed || typeof parsed.expiresAt !== "number") return null;
    if (Date.now() > parsed.expiresAt) {
      window.localStorage.removeItem(CACHE_KEY);
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
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    /* localStorage lleno o deshabilitado; degradar silenciosamente */
  }
}

export function clearModuleAccessCache(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch {
    /* nop */
  }
}

/**
 * Lectura SÍNCRONA del cache (sin red, sin promesas).
 *
 * Usada por el Sidebar para hidratar `useState` inicial: si hay cache válido,
 * el menú se renderiza directamente sin pasar por el estado "Cargando…",
 * incluso cuando Chrome descartó la pestaña y la remonta al volver.
 *
 * Devuelve null si no hay cache, está expirado, o estamos en SSR.
 */
export function peekModuleAccessCache(): ModuleAccessResponse | null {
  return readCache();
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
