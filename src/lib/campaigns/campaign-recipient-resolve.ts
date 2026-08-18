import "server-only";
import type { SupabaseAdmin } from "@/lib/chat/types";
import { normalizeWaPhone } from "@/lib/chat/wa-phone";
import { digitsInternational } from "@/lib/campaigns/campaign-phone";
import { campaignReplyLookbackMs } from "@/lib/campaigns/campaign-reply-window";

export type ResolvedCampaignRecipientRow = {
  id: string;
  campaign_id: string;
  phone_e164: string;
  status: string;
  first_reply_at: string | null;
  sent_at: string | null;
};

/**
 * Destinatario de campaña más reciente para este teléfono/canal (envíos dentro de la ventana).
 * Incluye status sent y replied (segundo clic en botón). No filtra por botón.
 */
export async function resolveLatestCampaignRecipientForInbound(params: {
  supabase: SupabaseAdmin;
  empresaId: string;
  channelId: string;
  phoneDigits: string;
  inboundMs: number;
}): Promise<ResolvedCampaignRecipientRow | null> {
  const lookbackMs = campaignReplyLookbackMs();
  const lookbackStartIso = new Date(params.inboundMs - lookbackMs).toISOString();
  const inboundIso = new Date(params.inboundMs).toISOString();
  const phoneCandidates = Array.from(
    new Set([`+${params.phoneDigits}`, params.phoneDigits].filter(Boolean))
  );

  const { data: campaigns, error: campErr } = await params.supabase
    .from("chat_campaigns")
    .select("id")
    .eq("empresa_id", params.empresaId)
    .eq("channel_id", params.channelId)
    .neq("status", "cancelled");

  if (campErr || !campaigns?.length) return null;

  const campaignIds = (campaigns as { id: string }[]).map((c) => c.id);

  const recipientsBase = () =>
    params.supabase
      .from("chat_campaign_recipients")
      .select("id, campaign_id, status, phone_e164, sent_at, first_reply_at")
      .eq("empresa_id", params.empresaId)
      .in("campaign_id", campaignIds)
      .in("status", ["sent", "replied"])
      .not("sent_at", "is", null)
      .lte("sent_at", inboundIso)
      .gte("sent_at", lookbackStartIso);

  let { data: rows, error: rErr } = await recipientsBase()
    .in("phone_e164", phoneCandidates)
    .order("sent_at", { ascending: false });

  if (rErr || !rows?.length) {
    const fb = await recipientsBase()
      .ilike("phone_e164", `%${params.phoneDigits}%`)
      .order("sent_at", { ascending: false });
    rows = fb.data;
    rErr = fb.error;
  }

  if (rErr || !rows?.length) return null;

  for (const r of rows as ResolvedCampaignRecipientRow[]) {
    const d = normalizeWaPhone(digitsInternational(r.phone_e164));
    if (d !== params.phoneDigits) continue;
    if (!r.sent_at) continue;
    const sentMs = Date.parse(r.sent_at);
    if (Number.isNaN(sentMs) || sentMs > params.inboundMs) continue;
    if (params.inboundMs - sentMs > lookbackMs) continue;
    return r;
  }

  return null;
}
