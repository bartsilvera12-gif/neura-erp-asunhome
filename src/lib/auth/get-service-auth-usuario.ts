import { createClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import type { ModulosSupabase } from "@/lib/modulos/resolve-effective-modules";
import { supabaseServiceRoleClientOptions } from "@/lib/supabase/schema";
import { getAuthUserForApiRoute } from "@/lib/auth/get-auth-user-for-api-route";
import {
  resolveUsuarioErpFromAuthUser,
  type UsuarioErpBasico,
} from "@/lib/auth/resolve-usuario-erp";

/**
 * Sesión Auth (Bearer o cookies) + fila `zentra_erp.usuarios` vía service role.
 * Para rutas /api/empresas/usuarios/* que antes solo leían cookies.
 */
export async function getServiceAuthUsuario(request: Request): Promise<
  | { ok: true; authUser: User; supabaseSr: ModulosSupabase; catalogUsuario: UsuarioErpBasico | null }
  | { ok: false; status: 401 }
> {
  const authUser = await getAuthUserForApiRoute(request);
  if (!authUser?.id) return { ok: false, status: 401 };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return { ok: false, status: 401 };

  const supabaseSr = createClient(url, key, { ...supabaseServiceRoleClientOptions }) as ModulosSupabase;
  const catalogUsuario = await resolveUsuarioErpFromAuthUser(supabaseSr, authUser);
  return { ok: true, authUser, supabaseSr, catalogUsuario };
}
