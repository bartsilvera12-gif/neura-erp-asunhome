import { resolveUsuarioErpFromAuthUser } from "@/lib/auth/resolve-usuario-erp";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function trimJoinNombre(nombre: string | null | undefined): string {
  const t = (nombre ?? "").trim().replace(/\s+/g, " ");
  return t;
}

function capitalizeWords(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w.length === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

/**
 * Nombre a mostrar en UI para el usuario autenticado (Server Components).
 * Prioriza `zentra_erp.usuarios.nombre` leído con service role (misma resolución de fila que el resto del ERP),
 * luego metadata de Auth, luego email completo; evita usar solo la parte local del email como fallback principal.
 */
export async function getCurrentUserDisplayNameServer(): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "Usuario";

  try {
    const sr = createServiceRoleClient();
    const usuario = await resolveUsuarioErpFromAuthUser(sr, user);
    if (usuario?.id) {
      const { data: row, error } = await sr
        .from("usuarios")
        .select("nombre, email")
        .eq("id", usuario.id)
        .maybeSingle();
      if (!error && row) {
        const r = row as { nombre?: string | null; email?: string | null };
        const fromNombre = trimJoinNombre(r.nombre ?? undefined);
        if (fromNombre.length > 0) return capitalizeWords(fromNombre);
        const mail = (r.email ?? user.email ?? "").trim();
        if (mail.length > 0) return mail;
      }
    }
  } catch (e) {
    console.warn("[getCurrentUserDisplayNameServer] catálogo usuarios:", e);
  }

  const meta = user.user_metadata as Record<string, unknown> | undefined;
  const fullName = typeof meta?.full_name === "string" ? meta.full_name.trim() : "";
  if (fullName) return capitalizeWords(fullName);

  const email = user.email?.trim();
  if (email) return email;

  return "Usuario";
}
