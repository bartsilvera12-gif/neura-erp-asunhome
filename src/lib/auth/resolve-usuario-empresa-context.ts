import type { User } from "@supabase/supabase-js";
import {
  resolveApiAuthContext,
  type ApiAuthFailureCode,
  type ResolveApiAuthOptions,
} from "@/lib/middleware/api-auth-context";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Contexto estándar post-`getUser`: catálogo `zentra_erp.usuarios` vía service role cuando hay
 * `SUPABASE_SERVICE_ROLE_KEY` (ver `resolveApiAuthContext`), más `empresas.data_schema` resuelto.
 * El cliente `userScopedSupabase` sigue siendo anon+JWT para consultas con RLS del usuario.
 */
export type UsuarioEmpresaAuthSuccess = {
  user: User;
  empresa_id: string | null;
  usuarioCatalogId: string | null;
  rol: string | null;
  nombre: string | null;
  /** PostgREST schema de datos operativos; `null` si no hay `empresa_id`. */
  resolvedDataSchema: string | null;
  userScopedSupabase: AppSupabaseClient;
};

export type ResolveUsuarioEmpresaResult =
  | { ok: true; ctx: UsuarioEmpresaAuthSuccess }
  | { ok: false; code: ApiAuthFailureCode; detail?: string };

export async function resolveUsuarioEmpresaContextFromAuth(
  request?: Request | null,
  opts?: ResolveApiAuthOptions
): Promise<ResolveUsuarioEmpresaResult> {
  const r = await resolveApiAuthContext(request, opts);
  if (!r.ok) return r;

  let resolvedDataSchema: string | null = null;
  if (r.ctx.empresa_id) {
    resolvedDataSchema = await fetchDataSchemaForEmpresaId(r.ctx.empresa_id);
  }

  return {
    ok: true,
    ctx: {
      user: r.ctx.user,
      empresa_id: r.ctx.empresa_id,
      usuarioCatalogId: r.ctx.usuarioCatalogId ?? null,
      rol: r.ctx.usuarioRol ?? null,
      nombre: r.ctx.usuarioNombre ?? null,
      resolvedDataSchema,
      userScopedSupabase: r.ctx.userScopedSupabase,
    },
  };
}
