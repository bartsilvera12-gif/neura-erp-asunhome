import { getUserAndEmpresa, type UsuarioConEmpresa } from "@/lib/middleware/auth";
import { createTenantPgChatSupabaseShim } from "@/lib/chat/tenant-pg-chat-supabase-shim";
import {
  createServiceRoleClientForEmpresa,
  fetchDataSchemaForEmpresaId,
} from "@/lib/supabase/empresa-data-schema";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { isLikelyUnexposedTenantChatSchema } from "@/lib/supabase/chat-data-schema";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

const LOG = "[sifen-config-service-client]";

/**
 * Service role contra el schema de datos de la empresa para tablas de configuración SIFEN.
 *
 * - `data_schema` vacío o expuesto en PostgREST → `createServiceRoleClient` estándar.
 * - `data_schema = erp_*` no expuesto → shim Postgres (mismo pool / DIRECT_URL que chat/proyectos).
 *
 * Permite que la pantalla y APIs `/api/configuracion/sifen[/certificado]` lean y escriban
 * `empresa_sifen_config` en tenants `erp_*` sin requerir exponer el schema en PostgREST
 * (evita errores `PGRST106 Invalid schema`).
 */
export async function getSifenConfigServiceClientForEmpresa(
  empresaId: string
): Promise<AppSupabaseClient> {
  const schema = await fetchDataSchemaForEmpresaId(empresaId);
  const pool = getChatPostgresPool();

  if (pool && isLikelyUnexposedTenantChatSchema(schema)) {
    const catalog = createServiceRoleClient();
    console.info(LOG, "modo", "postgres_shim", {
      empresa_id: empresaId,
      data_schema: schema,
    });
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
        "Schemas erp_* no están expuestos en PostgREST; se requiere PG directo para leer/escribir empresa_sifen_config.",
    });
    throw new Error(
      "Falta SUPABASE_DB_URL o DIRECT_URL en el servidor (p. ej. Vercel → Environment Variables). " +
        "Sin conexión directa a Postgres no se puede leer la configuración SIFEN del schema de esta empresa (erp_*). " +
        "Usá la misma cadena que en .env.local para migraciones."
    );
  }

  return createServiceRoleClientForEmpresa(empresaId);
}

/**
 * Atajo equivalente a `getTenantSupabaseFromAuth` pero específico para SIFEN config:
 * resuelve auth + cliente apuntando al schema de la empresa con fallback automático a PG directo
 * cuando el schema tenant no está expuesto en PostgREST.
 */
export async function getSifenConfigSupabaseFromAuth(
  request?: Request | null
): Promise<{ auth: UsuarioConEmpresa; supabase: AppSupabaseClient } | null> {
  const auth = await getUserAndEmpresa(request);
  if (!auth) return null;
  const supabase = await getSifenConfigServiceClientForEmpresa(auth.empresa_id);
  return { auth, supabase };
}
