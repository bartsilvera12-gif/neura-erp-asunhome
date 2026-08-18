import type { User } from "@supabase/supabase-js";
import type { ModulosSupabase } from "@/lib/modulos/resolve-effective-modules";
import { usuarioEmailLookupVariants } from "@/lib/auth/usuario-email-variants";

export type UsuarioErpBasico = {
  id: string;
  empresa_id: string | null;
  rol: string | null;
};

/**
 * Resuelve la fila `zentra_erp.usuarios` para la sesión de Auth.
 * Prioridad: `auth_user_id` → emails (JWT + GoTrue admin por si el JWT viene incompleto) con variantes de typo.
 */
export async function resolveUsuarioErpFromAuthUser(
  supabase: ModulosSupabase,
  user: User | null
): Promise<UsuarioErpBasico | null> {
  if (!user?.id) return null;

  const { data: byAuth, error: errAuth } = await supabase
    .from("usuarios")
    .select("id, empresa_id, rol")
    .eq("auth_user_id", user.id)
    .limit(1);
  if (errAuth) {
    console.error("[resolveUsuarioErpFromAuthUser] auth_user_id:", errAuth.message);
  }
  const hitAuth = byAuth?.[0] as UsuarioErpBasico | undefined;
  if (hitAuth) return hitAuth;

  const emailsToTry = new Set<string>();
  for (const e of usuarioEmailLookupVariants(user.email ?? "")) emailsToTry.add(e);

  if (typeof supabase.auth?.admin?.getUserById === "function") {
    try {
      const { data: adm, error: admErr } = await supabase.auth.admin.getUserById(user.id);
      if (admErr) {
        console.error("[resolveUsuarioErpFromAuthUser] admin.getUserById:", admErr.message);
      } else {
        for (const e of usuarioEmailLookupVariants(adm?.user?.email ?? "")) emailsToTry.add(e);
      }
    } catch (e) {
      console.error("[resolveUsuarioErpFromAuthUser] admin:", e);
    }
  }

  for (const em of emailsToTry) {
    const { data: rows, error } = await supabase
      .from("usuarios")
      .select("id, empresa_id, rol")
      .ilike("email", em)
      .limit(1);
    if (error) {
      console.error("[resolveUsuarioErpFromAuthUser] email:", error.message);
      continue;
    }
    const r = rows?.[0] as UsuarioErpBasico | undefined;
    if (r) return r;
  }

  return null;
}
