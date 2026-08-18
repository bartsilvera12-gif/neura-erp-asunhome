import {
  getAuthWithRol,
  getUserAndEmpresa,
  type UsuarioConEmpresa,
  type UsuarioConEmpresaYRol,
} from "@/lib/middleware/auth";
import { createTenantPgChatSupabaseShim } from "@/lib/chat/tenant-pg-chat-supabase-shim";
import {
  createServiceRoleClientForEmpresa,
  fetchDataSchemaForEmpresaId,
} from "@/lib/supabase/empresa-data-schema";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { isLikelyUnexposedTenantChatSchema } from "@/lib/supabase/chat-data-schema";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

const LOG = "[clientes-service-client]";

/**
 * Service role contra el schema de datos de la empresa para Clientes / catálogo `cliente_tipos_servicio_catalogo`.
 *
 * - `data_schema` vacío o expuesto (zentra_erp) → cliente service role estándar (db.schema PostgREST).
 * - `data_schema = erp_*` no expuesto en PostgREST → shim Postgres (mismo pool DIRECT_URL que chat/SIFEN/proyectos).
 *
 * Evita `PGRST106 Invalid schema` en `/api/clientes[*]` y `/api/cliente-tipos-servicio[*]` cuando la
 * empresa tiene su propio schema clonado (erp_*) sin exponerlo en PostgREST.
 */
export async function getClientesServiceClientForEmpresa(
  empresaId: string
): Promise<AppSupabaseClient> {
  const schema = await fetchDataSchemaForEmpresaId(empresaId);
  const pool = getChatPostgresPool();

  if (pool && isLikelyUnexposedTenantChatSchema(schema)) {
    const catalog = createServiceRoleClient();
    console.info(LOG, "modo", "postgres_shim", { empresa_id: empresaId, data_schema: schema });
    return createTenantPgChatSupabaseShim({
      pool,
      schema,
      storageDelegate: catalog,
      rpcDelegate: catalog as AppSupabaseClient,
    }) as unknown as AppSupabaseClient;
  }

  if (!pool && isLikelyUnexposedTenantChatSchema(schema)) {
    console.error(LOG, "tenant_sin_pool_postgrest_suele_fallar", {
      empresa_id: empresaId,
      data_schema: schema,
      hint:
        "Faltan SUPABASE_DB_URL / DIRECT_URL en el servidor. " +
        "Schemas erp_* no están expuestos en PostgREST; se requiere PG directo para leer/escribir clientes.",
    });
    throw new Error(
      "Falta SUPABASE_DB_URL o DIRECT_URL en el servidor (p. ej. Vercel → Environment Variables). " +
        "Sin conexión directa a Postgres no se puede leer/escribir clientes en el schema de esta empresa (erp_*). " +
        "Usá la misma cadena que en .env.local para migraciones."
    );
  }

  return createServiceRoleClientForEmpresa(empresaId);
}

/** Auth + cliente (sin rol). Drop-in para `getTenantSupabaseFromAuth` en rutas que no exigen rol. */
export async function getClientesSupabaseFromAuth(
  request?: Request | null
): Promise<{ auth: UsuarioConEmpresa; supabase: AppSupabaseClient } | null> {
  const auth = await getUserAndEmpresa(request);
  if (!auth) return null;
  const supabase = await getClientesServiceClientForEmpresa(auth.empresa_id);
  return { auth, supabase };
}

/** Auth con rol + cliente. Drop-in para `getTenantSupabaseFromAuthWithRol`. */
export async function getClientesSupabaseFromAuthWithRol(
  request?: Request | null
): Promise<{ auth: UsuarioConEmpresaYRol; supabase: AppSupabaseClient } | null> {
  const auth = await getAuthWithRol(request);
  if (!auth?.empresa_id) return null;
  const supabase = await getClientesServiceClientForEmpresa(auth.empresa_id);
  return { auth, supabase };
}
