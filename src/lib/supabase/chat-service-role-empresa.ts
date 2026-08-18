import { createTenantPgChatSupabaseShim } from "@/lib/chat/tenant-pg-chat-supabase-shim";
import {
  createServiceRoleClientForEmpresa,
  fetchDataSchemaForEmpresaId,
} from "@/lib/supabase/empresa-data-schema";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { isLikelyUnexposedTenantChatSchema } from "@/lib/supabase/chat-data-schema";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

const LOG = "[chat-service-client]";

/**
 * Service role sobre el schema de datos de la empresa (`zentra_erp` o `erp_*`).
 * Para `erp_*` / `er_*` no expuestos en PostgREST: shim Postgres (pool DIRECT_URL).
 */
export async function getChatServiceClientForEmpresa(empresaId: string): Promise<AppSupabaseClient> {
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
        "En Vercel/producción: agregar SUPABASE_DB_URL o DIRECT_URL (misma URL que migraciones) para usar PG directo en schemas erp_* no expuestos en PostgREST.",
    });
    throw new Error(
      "Falta SUPABASE_DB_URL o DIRECT_URL en el servidor (p. ej. Vercel → Environment Variables). " +
        "Sin conexión directa a Postgres no se pueden guardar bloques/nodos del flujo en el schema de esta empresa (erp_*). " +
        "Usá la misma cadena que en .env.local para migraciones."
    );
  }
  return createServiceRoleClientForEmpresa(empresaId);
}
