import {
  getAuthWithRol,
  getUserAndEmpresa,
  type UsuarioConEmpresa,
  type UsuarioConEmpresaYRol,
} from "@/lib/middleware/auth";
import { createServiceRoleClientForEmpresa } from "@/lib/supabase/empresa-data-schema";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

/** Service role apuntando al schema de datos de la empresa (`data_schema` o plantilla zentra_erp). */
export async function getTenantSupabaseFromAuth(request?: Request | null): Promise<{
  auth: UsuarioConEmpresa;
  supabase: AppSupabaseClient;
} | null> {
  const auth = await getUserAndEmpresa(request);
  if (!auth) return null;
  const supabase = await createServiceRoleClientForEmpresa(auth.empresa_id);
  return { auth, supabase };
}

export async function getTenantSupabaseFromAuthWithRol(request?: Request | null): Promise<{
  auth: UsuarioConEmpresaYRol;
  supabase: AppSupabaseClient;
} | null> {
  const auth = await getAuthWithRol(request);
  if (!auth?.empresa_id) return null;
  const supabase = await createServiceRoleClientForEmpresa(auth.empresa_id);
  return { auth, supabase };
}
