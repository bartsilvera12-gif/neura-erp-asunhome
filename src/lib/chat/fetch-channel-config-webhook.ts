/**
 * Solo servidor / webhook: lee `chat_channels.config` vía Postgres directo o PostgREST.
 * Separado de `bot-wake-keywords.ts` para no arrastrar `pg` al bundle del cliente.
 */

import type { SupabaseAdmin } from "@/lib/chat/types";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import type { Pool } from "pg";

export async function fetchChatChannelConfigForWebhookWakeKeywords(params: {
  pool: Pool | null;
  useTenantPg: boolean;
  tenantDataSchema: string;
  empresaId: string;
  channelId: string;
  supabase: SupabaseAdmin;
}): Promise<Record<string, unknown>> {
  const { pool, useTenantPg, tenantDataSchema, empresaId, channelId, supabase } = params;
  try {
    if (useTenantPg && pool) {
      const schema = assertAllowedChatDataSchema(tenantDataSchema);
      const qt = quoteSchemaTable(schema, "chat_channels");
      const r = await pool.query(`SELECT config FROM ${qt} WHERE id = $1::uuid AND empresa_id = $2::uuid LIMIT 1`, [
        channelId,
        empresaId,
      ]);
      const cfg = r.rows?.[0]?.config;
      return cfg && typeof cfg === "object" && !Array.isArray(cfg)
        ? (cfg as Record<string, unknown>)
        : {};
    }
    const { data, error } = await supabase
      .from("chat_channels")
      .select("config")
      .eq("id", channelId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (error) {
      console.warn("[bot_wake_keywords]", "fetch_config_error", { message: error.message });
      return {};
    }
    const cfg = (data as { config?: unknown } | null)?.config;
    return cfg && typeof cfg === "object" && !Array.isArray(cfg) ? (cfg as Record<string, unknown>) : {};
  } catch (e) {
    console.warn("[bot_wake_keywords]", "fetch_config_exception", {
      message: e instanceof Error ? e.message : String(e),
    });
    return {};
  }
}
