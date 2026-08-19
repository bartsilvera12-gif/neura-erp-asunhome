import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { serializeUnknownError } from "@/lib/errors/serialize-unknown-error";
import { clearBrowserEmpresaDataSchemaCache } from "@/lib/supabase/browser-data-client";
import { usuarioEmailLookupVariants } from "@/lib/auth/usuario-email-variants";
import { clearModuleAccessCache } from "@/lib/modulos/module-access-cache";
import { supabase } from "./supabase";

/** Fila mínima de zentra_erp.usuarios usada en el cliente. */
export type CurrentUsuario = {
  id: string;
  empresa_id: string | null;
  email?: string | null;
  nombre?: string | null;
  rol?: string | null;
  estado?: string | null;
  telefono?: string | null;
  fecha_nacimiento?: string | null;
  auth_user_id?: string | null;
  created_at?: string | null;
};

export async function signIn(email: string, password: string) {
  clearBrowserEmpresaDataSchemaCache();
  // Borrar cache del usuario anterior si quedó residual en localStorage —
  // evita que el Sidebar muestre brevemente los módulos del usuario previo
  // antes de que el SIGNED_IN haga refresh.
  clearModuleAccessCache();
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  clearBrowserEmpresaDataSchemaCache();
  clearModuleAccessCache();
  return supabase.auth.signOut();
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function createUser(email: string, password: string) {
  const res = await fetchWithSupabaseSession("/api/create-user", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const json = await res.json();

  if (!res.ok) {
    throw new Error(
      typeof json.error === "string"
        ? json.error
        : json.error?.message || "Error creando usuario"
    );
  }

  return json.user;
}

export async function getCurrentUser(): Promise<CurrentUsuario | null> {
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  if (user.id) {
    const { data: byAuth, error: errAuth } = await supabase
      .from("usuarios")
      .select("*")
      .eq("auth_user_id", user.id)
      .limit(1);
    if (errAuth) throw new Error(serializeUnknownError(errAuth));
    const rowAuth = byAuth?.[0] as CurrentUsuario | undefined;
    if (rowAuth) return rowAuth;
  }

  const email = user.email?.trim();
  if (!email) return null;

  for (const em of usuarioEmailLookupVariants(email)) {
    const { data: rows, error } = await supabase
      .from("usuarios")
      .select("*")
      .ilike("email", em)
      .limit(1);
    if (error) throw new Error(serializeUnknownError(error));
    const row = rows?.[0] as CurrentUsuario | undefined;
    if (row) return row;
  }

  return null;
}
