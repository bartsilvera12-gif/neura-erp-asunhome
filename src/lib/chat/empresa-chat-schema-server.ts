import { resolveDataSchemaForCurrentUserServer } from "@/lib/supabase/empresa-data-server";

/** Esquema PostgREST donde viven las tablas chat_* para el usuario actual (Server Components). */
export async function getChatDataSchemaForCurrentUser(): Promise<string> {
  return resolveDataSchemaForCurrentUserServer();
}
