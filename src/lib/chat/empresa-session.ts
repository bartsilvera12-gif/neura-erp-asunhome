import { getUsuarioCatalogFromServerCookies } from "@/lib/auth/usuario-catalog-from-server-session";
import { createSupabaseServerClient, createSupabaseServerClientWithDbSchema } from "@/lib/supabase/server";
import { SUPABASE_APP_SCHEMA, resolveEmpresaDataSchema, type AppSupabaseClient } from "@/lib/supabase/schema";

export type EmpresaUsuarioSession = {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  empresa_id: string;
  usuario_id: string;
};

/** Sesión para tablas omnicanal (chat_*): esquema tenant si `empresas.data_schema` está definido. */
export type EmpresaChatSession = {
  supabase: AppSupabaseClient;
  catalogSupabase: AppSupabaseClient;
  empresa_id: string;
  usuario_id: string;
  dataSchema: string;
};

/**
 * Usuario autenticado (auth) alineado a `zentra_erp.usuarios` de su empresa.
 */
export async function requireEmpresaUsuarioSession(): Promise<EmpresaUsuarioSession> {
  const supabase = await createSupabaseServerClient();
  const cat = await getUsuarioCatalogFromServerCookies();
  if (!cat) {
    throw new Error("Usuario no autenticado o sin empresa");
  }
  return { supabase, empresa_id: cat.empresa_id, usuario_id: cat.id };
}

/**
 * Catálogo (usuarios, empresas) en zentra_erp; datos de chat en `data_schema` de la empresa o zentra_erp.
 */
export async function requireEmpresaChatSession(): Promise<EmpresaChatSession> {
  const catalogSupabase = await createSupabaseServerClient();
  const cat = await getUsuarioCatalogFromServerCookies();
  if (!cat) {
    throw new Error("Usuario no autenticado o sin empresa");
  }
  const { empresa_id, id: usuario_id } = cat;

  const { data: empRow } = await catalogSupabase
    .from("empresas")
    .select("data_schema")
    .eq("id", empresa_id)
    .maybeSingle();

  const dataSchema = resolveEmpresaDataSchema(
    (empRow as { data_schema?: string | null } | null)?.data_schema
  );

  const supabase: AppSupabaseClient =
    dataSchema === SUPABASE_APP_SCHEMA
      ? (catalogSupabase as AppSupabaseClient)
      : ((await createSupabaseServerClientWithDbSchema(dataSchema)) as AppSupabaseClient);

  return { supabase, catalogSupabase: catalogSupabase as AppSupabaseClient, empresa_id, usuario_id, dataSchema };
}
