import { createClient } from "@supabase/supabase-js";
import { supabaseServiceRoleClientOptions, type AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Singleton del cliente service-role.
 *
 * Antes: cada `createServiceRoleClient()` instanciaba un nuevo cliente Supabase.
 * Con cientos de llamadas por request (auth context, mirrors, lookups), el GC
 * y la apertura de fetch handlers/keep-alives generaba overhead innecesario.
 *
 * Ahora: una sola instancia por runtime Node (sobrevive hot-reload vía globalThis).
 * El cliente service-role no tiene sesión por usuario — siempre usa la misma
 * SUPABASE_SERVICE_ROLE_KEY y las mismas options, por lo que reutilizarlo es seguro.
 *
 * Patrón idéntico al de getChatPostgresPool() en chat-pg-pool.ts.
 */
const GLOBAL_KEY = "__neura_SERVICE_ROLE_CLIENT_SINGLETON__" as const;

function readGlobalServiceRoleClient(): AppSupabaseClient | undefined {
  const g = globalThis as unknown as Record<string, AppSupabaseClient | undefined>;
  return g[GLOBAL_KEY];
}

function writeGlobalServiceRoleClient(client: AppSupabaseClient): void {
  const g = globalThis as unknown as Record<string, AppSupabaseClient | undefined>;
  g[GLOBAL_KEY] = client;
}

/** Cliente service role (servidor): webhooks, /r redirect, jobs. */
export function createServiceRoleClient(): AppSupabaseClient {
  const cached = readGlobalServiceRoleClient();
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  }

  const client = createClient(url, key, { ...supabaseServiceRoleClientOptions }) as AppSupabaseClient;
  writeGlobalServiceRoleClient(client);
  return client;
}
