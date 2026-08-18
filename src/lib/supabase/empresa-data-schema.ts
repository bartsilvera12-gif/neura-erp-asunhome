import { createClient } from "@supabase/supabase-js";
import {
  NEURA_CLIENT_SCHEMA,
  type AppSupabaseClient,
} from "@/lib/supabase/schema";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";

/**
 * Instancia dedicada monocliente: no consulta `empresas.data_schema`.
 * Devuelve siempre el schema único de la instancia. Firma async preservada
 * para compatibilidad con callers existentes.
 */
export async function fetchDataSchemaForEmpresaId(_empresaId: string): Promise<string> {
  return NEURA_CLIENT_SCHEMA;
}

/** Service role apuntando a un schema arbitrario (compat para callers existentes). */
export function createServiceRoleClientWithDbSchema(schema: string): AppSupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema },
  }) as AppSupabaseClient;
}

/**
 * Instancia dedicada: cliente service role en el schema único.
 * Se ignora `empresaId`. Firma preservada.
 */
export async function createServiceRoleClientForEmpresa(_empresaId: string): Promise<AppSupabaseClient> {
  return createServiceRoleClient();
}
