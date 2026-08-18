import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import { usuarioEmailLookupVariants } from "@/lib/auth/usuario-email-variants";
import { supabaseDbSchemaOption, type AppSupabaseClient } from "@/lib/supabase/schema";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";

export type ApiAuthFailureCode =
  | "missing_public_env"
  | "no_session"
  | "usuario_query_error"
  | "usuario_zero_rows"
  | "empresa_id_null";

export type ApiAuthContext = {
  user: User;
  /** null solo cuando forDataSchemaEndpoint y super_admin sin empresa. */
  empresa_id: string | null;
  /** PK `zentra_erp.usuarios.id` cuando se resolvió la fila (service role o RLS). */
  usuarioCatalogId?: string | null;
  /** Cliente anon + JWT del usuario (cookies o Bearer). PostgREST respeta RLS en zentra_erp. */
  userScopedSupabase: AppSupabaseClient;
  usuarioRol?: string | null;
  usuarioNombre?: string | null;
};

export type ApiAuthResult =
  | { ok: true; ctx: ApiAuthContext }
  | { ok: false; code: ApiAuthFailureCode; detail?: string };

function extractBearerFromRequest(request?: Request | null): string | null {
  const h = request?.headers.get("authorization");
  if (!h?.toLowerCase().startsWith("bearer ")) return null;
  const t = h.slice(7).trim();
  return t || null;
}

type BearerResolved = { token: string | null; source: "request" | "next-headers" | "none" };

async function resolveBearerToken(request?: Request | null): Promise<BearerResolved> {
  const fromReq = extractBearerFromRequest(request);
  if (fromReq) return { token: fromReq, source: "request" };
  try {
    const h = await headers();
    const a = h.get("authorization");
    if (a?.toLowerCase().startsWith("bearer ")) {
      const t = a.slice(7).trim();
      if (t) return { token: t, source: "next-headers" };
    }
  } catch {
    /* fuera de contexto de petición */
  }
  return { token: null, source: "none" };
}

type UsuarioRow = {
  id?: string;
  empresa_id?: string | null;
  rol?: string | null;
  nombre?: string | null;
};

export type ResolveApiAuthOptions = {
  forDataSchemaEndpoint?: boolean;
};

/**
 * Memoización por-request: cuando dentro de un mismo route handler se llama a
 * `resolveApiAuthContext()` desde múltiples lugares (helpers de auth, contexts, etc.),
 * cada call disparaba un nuevo `auth.getUser()` HTTP a Supabase + lookup en `usuarios`.
 *
 * Con la cache en WeakMap<Request, Promise>:
 *  - La primera invocación dispara el trabajo.
 *  - Llamadas subsiguientes en el mismo request comparten la misma Promise.
 *  - Cuando el Request termina y queda sin referencias, GC limpia la entrada solo.
 *
 * Excluido del cache:
 *  - Sin `request` (no hay key estable para el WeakMap).
 *  - Con `forDataSchemaEndpoint` (cambia el comportamiento de retorno; no mezclar resultados).
 */
const requestCache = new WeakMap<Request, Promise<ApiAuthResult>>();

/**
 * Auth: `getUser` con anon + URL públicos (sin db.schema en el cliente de Auth).
 * Catálogo `zentra_erp.usuarios`: con `SUPABASE_SERVICE_ROLE_KEY` se lee por service role
 * (misma idea que module-access); sin service key, fallback anon+JWT+RLS.
 * PostgREST usuario: `userScopedSupabase` (anon + JWT + schema) para rutas que consultan con RLS.
 */
export async function resolveApiAuthContext(
  request?: Request | null,
  opts?: ResolveApiAuthOptions
): Promise<ApiAuthResult> {
  if (!request || opts?.forDataSchemaEndpoint) {
    return resolveApiAuthContextUncached(request, opts);
  }
  const cached = requestCache.get(request);
  if (cached) return cached;
  const promise = resolveApiAuthContextUncached(request, opts);
  requestCache.set(request, promise);
  return promise;
}

async function resolveApiAuthContextUncached(
  request?: Request | null,
  opts?: ResolveApiAuthOptions
): Promise<ApiAuthResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) {
    return { ok: false, code: "missing_public_env" };
  }

  const bearerResolved = await resolveBearerToken(request);
  const bearer = bearerResolved.token;

  let user: User | null = null;
  let userScopedSupabase: AppSupabaseClient;

  if (bearer) {
    const authOnly = createClient(url, anonKey);
    const { data, error } = await authOnly.auth.getUser(bearer);
    if (error || !data.user?.id) {
      return { ok: false, code: "no_session", detail: error?.message };
    }
    user = data.user;

    userScopedSupabase = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${bearer}` } },
      ...supabaseDbSchemaOption,
    }) as AppSupabaseClient;
  } else {
    const cookieStore = await cookies();

    const authOnly = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll().map((c) => ({ name: c.name, value: c.value }));
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    });
    const { data, error } = await authOnly.auth.getUser();
    if (error || !data.user?.id) {
      return { ok: false, code: "no_session", detail: error?.message };
    }
    user = data.user;

    userScopedSupabase = createServerClient(url, anonKey, {
      ...supabaseDbSchemaOption,
      cookies: {
        getAll() {
          return cookieStore.getAll().map((c) => ({ name: c.name, value: c.value }));
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }) as AppSupabaseClient;
  }

  let row: UsuarioRow | undefined;
  let lastUsuarioErr: string | null = null;

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (serviceKey) {
    const sr = createServiceRoleClient();
    if (user.id) {
      const { data: byId, error: e1 } = await sr
        .from("usuarios")
        .select("id, empresa_id, rol, nombre")
        .eq("auth_user_id", user.id)
        .limit(1);
      if (e1) lastUsuarioErr = e1.message;
      else if (byId?.[0]) row = byId[0] as UsuarioRow;
    }
    if (!row && user.email) {
      for (const em of usuarioEmailLookupVariants(user.email)) {
        const { data: rows, error: uErr } = await sr
          .from("usuarios")
          .select("id, empresa_id, rol, nombre")
          .ilike("email", em)
          .limit(1);
        if (uErr) {
          lastUsuarioErr = uErr.message;
          break;
        }
        if (rows?.[0]) {
          row = rows[0] as UsuarioRow;
          break;
        }
      }
    }
  } else {
    if (user.id) {
      const { data: byId, error: e1 } = await userScopedSupabase
        .from("usuarios")
        .select("id, empresa_id, rol, nombre")
        .eq("auth_user_id", user.id)
        .limit(1);
      if (e1) lastUsuarioErr = e1.message;
      else if (byId?.[0]) row = byId[0] as UsuarioRow;
    }
    if (!row && user.email) {
      for (const em of usuarioEmailLookupVariants(user.email)) {
        const { data: rows, error: uErr } = await userScopedSupabase
          .from("usuarios")
          .select("id, empresa_id, rol, nombre")
          .ilike("email", em)
          .limit(1);
        if (uErr) {
          lastUsuarioErr = uErr.message;
          break;
        }
        if (rows?.[0]) {
          row = rows[0] as UsuarioRow;
          break;
        }
      }
    }
  }

  if (!row && lastUsuarioErr) {
    return { ok: false, code: "usuario_query_error", detail: lastUsuarioErr };
  }

  if (!row) {
    return { ok: false, code: "usuario_zero_rows" };
  }

  const empresa_id = row.empresa_id ?? null;
  const usuarioRol = row.rol ?? null;
  const usuarioNombre = row.nombre ?? null;
  const usuarioCatalogId = typeof row.id === "string" ? row.id : null;

  if (empresa_id) {
    return {
      ok: true,
      ctx: {
        user,
        empresa_id,
        usuarioCatalogId,
        userScopedSupabase,
        usuarioRol,
        usuarioNombre,
      },
    };
  }

  if (opts?.forDataSchemaEndpoint && usuarioRol === "super_admin") {
    return {
      ok: true,
      ctx: {
        user,
        empresa_id: null,
        usuarioCatalogId,
        userScopedSupabase,
        usuarioRol,
        usuarioNombre,
      },
    };
  }

  return { ok: false, code: "empresa_id_null" };
}
