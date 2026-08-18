import type { NextRequest } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import type { QueueAdminTenantContext } from "@/lib/chat/queue-admin-repo";

/** `params.queueId` en App Router puede ser string o string[]; decodifica segmento de URL. */
export function normalizeQueueRouteId(raw: string | string[] | undefined): string {
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (first == null || typeof first !== "string") return "";
  const t = first.trim();
  if (!t) return "";
  try {
    return decodeURIComponent(t);
  } catch {
    return t;
  }
}

export async function resolveQueueAdminTenantContext(
  request: NextRequest
): Promise<{ ctx: QueueAdminTenantContext } | null> {
  const t = await getTenantSupabaseFromAuth(request);
  if (!t?.auth.empresa_id) return null;
  const ctx: QueueAdminTenantContext = {
    supabase: t.supabase,
    catalogSr: createServiceRoleClient(),
    empresa_id: t.auth.empresa_id,
  };
  return { ctx };
}
