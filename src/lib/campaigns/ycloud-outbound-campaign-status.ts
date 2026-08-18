import "server-only";
import type { Pool } from "pg";
import type { SupabaseAdmin } from "@/lib/chat/types";
import {
  extractInboundIdentifiers,
  extractSmbEchoIdentifiersForRouting,
} from "@/lib/chat/webhooks/ycloud-inbound-payload";
import {
  resolveYCloudChannelForWebhook,
  verifyYCloudWebhookSignatureForEmpresa,
  type ResolvedYCloudChannel,
} from "@/lib/chat/webhooks/ycloud-resolve-channel";
import { refreshCampaignCounters } from "@/lib/campaigns/campaign-job-service";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";

export function parseCampaignRecipientExternalId(
  externalId: string
): { campaignId: string; recipientId: string } | null {
  const m = /^campaign:([^:]+):recipient:([^:]+)$/i.exec(externalId.trim());
  if (!m) return null;
  return { campaignId: m[1], recipientId: m[2] };
}

function quoteSchemaIdent(schema: string): string {
  return `"${schema.replace(/"/g, '""')}"`;
}

async function listCampaignRecipientSchemas(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ nspname: string }>(`
    SELECT DISTINCT n.nspname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'chat_campaign_recipients'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\\_%' ESCAPE '\\'
      )
    ORDER BY 1
  `);
  return rows.map((r) => r.nspname);
}

export type CampaignRecipientPick = {
  id: string;
  empresa_id: string;
  campaign_id: string;
  status: string;
};

async function runRecipientQuery<T extends CampaignRecipientPick>(
  pool: Pool,
  buildSql: (sch: string) => { sql: string; args: unknown[] }
): Promise<T | null> {
  const schemas = await listCampaignRecipientSchemas(pool);
  for (const sch of schemas) {
    const { sql, args } = buildSql(sch);
    const { rows } = await pool.query(sql, args);
    const row = rows[0] as T | undefined;
    if (row?.id) return row;
  }
  return null;
}

export async function findCampaignRecipientByIdPg(
  pool: Pool,
  recipientId: string
): Promise<CampaignRecipientPick | null> {
  return runRecipientQuery(pool, (sch) => ({
    sql: `
      SELECT id, empresa_id, campaign_id, status
      FROM ${quoteSchemaIdent(sch)}.chat_campaign_recipients
      WHERE id = $1::uuid
      LIMIT 1`,
    args: [recipientId],
  }));
}

export async function findCampaignRecipientByProviderMessagePg(
  pool: Pool,
  messageId: string,
  wamid: string
): Promise<CampaignRecipientPick | null> {
  const ids = Array.from(new Set([messageId, wamid].map((s) => s.trim()).filter(Boolean)));
  if (ids.length === 0) return null;
  return runRecipientQuery(pool, (sch) => ({
    sql: `
      SELECT id, empresa_id, campaign_id, status
      FROM ${quoteSchemaIdent(sch)}.chat_campaign_recipients
      WHERE provider_message_id = ANY($1::text[])
      LIMIT 1`,
    args: [ids],
  }));
}

/**
 * Resuelve empresa + firma para `whatsapp.message.updated`:
 * 1) igual que inbound / eco SMB (from/to/waba),
 * 2) si falla, `externalId` campaign:…:recipient:… + firma por empresa.
 */
export async function resolveYCloudCampaignStatusWebhookContext(params: {
  rawBody: string;
  sigHeader: string | null;
  whatsappMessage: Record<string, unknown>;
}): Promise<{ resolved: ResolvedYCloudChannel; hintRecipient: CampaignRecipientPick | null } | null> {
  const msg = params.whatsappMessage;
  const ids =
    extractInboundIdentifiers(msg) ?? extractSmbEchoIdentifiersForRouting(msg) ?? null;

  if (ids) {
    const resolved = await resolveYCloudChannelForWebhook(params.rawBody, params.sigHeader, ids);
    if (resolved) return { resolved, hintRecipient: null };
  }

  const ext = typeof msg.externalId === "string" ? msg.externalId.trim() : "";
  const parsed = parseCampaignRecipientExternalId(ext);
  const pool = getChatPostgresPool();
  if (!parsed || !pool) return null;

  const hintRecipient = await findCampaignRecipientByIdPg(pool, parsed.recipientId);
  if (!hintRecipient) return null;

  const ok = await verifyYCloudWebhookSignatureForEmpresa(
    params.rawBody,
    params.sigHeader,
    hintRecipient.empresa_id
  );
  if (!ok) return null;

  const sb = await getChatServiceClientForEmpresa(hintRecipient.empresa_id);
  const { data: camp } = await sb
    .from("chat_campaigns")
    .select("channel_id")
    .eq("id", hintRecipient.campaign_id)
    .eq("empresa_id", hintRecipient.empresa_id)
    .maybeSingle();

  let channelId = typeof (camp as { channel_id?: string } | null)?.channel_id === "string"
    ? (camp as { channel_id: string }).channel_id
    : "";

  if (!channelId) {
    const { data: ch } = await sb
      .from("chat_channels")
      .select("id")
      .eq("empresa_id", hintRecipient.empresa_id)
      .eq("provider", "ycloud")
      .limit(1)
      .maybeSingle();
    channelId = typeof (ch as { id?: string } | null)?.id === "string" ? (ch as { id: string }).id : "";
  }

  const data_schema = await fetchDataSchemaForEmpresaId(hintRecipient.empresa_id);

  const resolved: ResolvedYCloudChannel = {
    empresa_id: hintRecipient.empresa_id,
    channel_id: channelId || "00000000-0000-0000-0000-000000000000",
    webhook_secret: "",
    data_schema,
  };

  return { resolved, hintRecipient };
}

export async function applyYCloudCampaignMessageUpdated(params: {
  resolved: ResolvedYCloudChannel;
  whatsappMessage: Record<string, unknown>;
  hintRecipient: CampaignRecipientPick | null;
}): Promise<void> {
  const wm = params.whatsappMessage;
  const mid = typeof wm.id === "string" ? wm.id.trim() : "";
  const wamid = typeof wm.wamid === "string" ? wm.wamid.trim() : "";
  const statusRaw = typeof wm.status === "string" ? wm.status.trim().toLowerCase() : "";
  const errorCode = wm.errorCode ?? (wm as { errroCode?: unknown }).errroCode;
  const errorMessage =
    typeof wm.errorMessage === "string"
      ? wm.errorMessage.trim()
      : typeof wm.message === "string"
        ? wm.message.trim()
        : "";
  const deliverTime = typeof wm.deliverTime === "string" ? wm.deliverTime : null;
  const readTime = typeof wm.readTime === "string" ? wm.readTime : null;

  const pool = getChatPostgresPool();

  let pick = params.hintRecipient;
  if (!pick && pool) {
    pick = await findCampaignRecipientByProviderMessagePg(pool, mid, wamid);
  }

  if (!pick || pick.empresa_id !== params.resolved.empresa_id) {
    if (pick && pick.empresa_id !== params.resolved.empresa_id) {
      console.warn("[ycloud-campaign-status] empresa_id distinta", {
        recipient_empresa: pick.empresa_id,
        resolved_empresa: params.resolved.empresa_id,
      });
    }
    return;
  }

  const sb = (await getChatServiceClientForEmpresa(pick.empresa_id)) as unknown as SupabaseAdmin;

  const { data: prevRow } = await sb
    .from("chat_campaign_recipients")
    .select("id, status")
    .eq("id", pick.id)
    .eq("empresa_id", pick.empresa_id)
    .maybeSingle();

  const prevStatus = String((prevRow as { status?: string } | null)?.status ?? "");

  const ts = new Date().toISOString();
  const statusSnap = {
    source: "ycloud_whatsapp.message.updated",
    status: statusRaw,
    ycloud_message_id: mid || null,
    wamid: wamid || null,
    received_at: ts,
  };

  const patch: Record<string, unknown> = {
    last_status_raw_json: statusSnap,
    updated_at: ts,
  };

  if (statusRaw === "failed") {
    patch.status = "failed";
    patch.failed_at = ts;
    patch.error_code = errorCode != null ? String(errorCode) : null;
    patch.error_message = (errorMessage || "Fallo de entrega (YCloud)").slice(0, 2000);
  } else if (statusRaw === "delivered") {
    patch.delivered_at = deliverTime ?? ts;
  } else if (statusRaw === "read") {
    patch.read_at = readTime ?? ts;
    if (deliverTime) patch.delivered_at = deliverTime;
  }

  await sb.from("chat_campaign_recipients").update(patch).eq("id", pick.id).eq("empresa_id", pick.empresa_id);

  const waKeys = [mid, wamid].filter(Boolean);
  if (waKeys.length > 0) {
    const msgPatch: Record<string, unknown> = {
      whatsapp_delivery_status: statusRaw || null,
    };
    if (statusRaw === "delivered") msgPatch.whatsapp_delivered_at = deliverTime ?? ts;
    if (statusRaw === "read") {
      msgPatch.whatsapp_read_at = readTime ?? ts;
      if (deliverTime) msgPatch.whatsapp_delivered_at = deliverTime;
    }
    await sb.from("chat_messages").update(msgPatch).eq("empresa_id", pick.empresa_id).in("wa_message_id", waKeys);
  }

  if (prevStatus === "sent" && statusRaw === "failed") {
    await refreshCampaignCounters(sb, pick.empresa_id, pick.campaign_id);
  }
}
