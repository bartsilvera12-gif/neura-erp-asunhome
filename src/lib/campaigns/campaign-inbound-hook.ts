import "server-only";
import type { SupabaseAdmin } from "@/lib/chat/types";
import { normalizeWaPhone } from "@/lib/chat/wa-phone";
import { resolveLatestCampaignRecipientForInbound } from "@/lib/campaigns/campaign-recipient-resolve";
import { campaignReplyLookbackMs } from "@/lib/campaigns/campaign-reply-window";

const LOG_IN = "[campaign-reply][inbound-received]";
const LOG_MATCH = "[campaign-reply][recipient-match]";
const LOG_MARK = "[campaign-reply][marked-first-reply]";
const LOG_NONE = "[campaign-reply][no-match]";

function maskPhoneDigits(digits: string): string {
  const d = digits.replace(/\D/g, "");
  if (d.length <= 4) return "****";
  return `****${d.slice(-4)}`;
}

/** Re-export para callers que importaban desde este módulo. */
export { campaignReplyLookbackMs } from "@/lib/campaigns/campaign-reply-window";

export type CampaignInboundReplyResult =
  | {
      matched: true;
      campaignId: string;
      recipientId: string;
      contactId: string;
      channelId: string;
      phoneE164: string;
      inboundAt: string;
      wasFirstReply: boolean;
    }
  | { matched: false; reason?: string };

/**
 * Tras un inbound real: resuelve el destinatario de campaña (mismo criterio que acciones de botón)
 * y, si aún no respondió, marca RESPONDIERON.
 *
 * Devuelve siempre el par campaignId/recipientId del envío más reciente al número en la ventana,
 * aunque la campaña esté `completed` (no se edita en UI, pero el inbound sigue vinculado a esa fila).
 */
export async function markCampaignReplyFromInbound(params: {
  supabase: SupabaseAdmin;
  empresaId: string;
  channelId: string;
  contactId: string;
  /** ISO del mensaje entrante (Meta timestamp o servidor). */
  inboundAtIso?: string;
  preview?: string;
  waMessageId?: string;
}): Promise<CampaignInboundReplyResult> {
  const { supabase, empresaId, channelId, contactId, inboundAtIso, preview, waMessageId } = params;

  const inboundTs =
    inboundAtIso?.trim() && !Number.isNaN(Date.parse(inboundAtIso))
      ? inboundAtIso.trim()
      : new Date().toISOString();
  const inboundMs = Date.parse(inboundTs);

  const { data: contact, error: cErr } = await supabase
    .from("chat_contacts")
    .select("phone_number")
    .eq("id", contactId)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (cErr || !contact) {
    console.info(LOG_NONE, {
      empresa_id: empresaId,
      contact_id: contactId,
      reason: "contact_not_found",
      wa_message_id: waMessageId ?? null,
    });
    return { matched: false, reason: "contact_not_found" };
  }

  const phoneDigits = normalizeWaPhone((contact as { phone_number?: string }).phone_number ?? "");
  if (!phoneDigits) {
    console.info(LOG_NONE, {
      empresa_id: empresaId,
      contact_id: contactId,
      reason: "contact_phone_empty",
      wa_message_id: waMessageId ?? null,
    });
    return { matched: false, reason: "contact_phone_empty" };
  }

  console.info(LOG_IN, {
    empresa_id: empresaId,
    channel_id: channelId,
    contact_id: contactId,
    phone_masked: maskPhoneDigits(phoneDigits),
    created_at: inboundTs,
    wa_message_id: waMessageId ?? null,
  });

  const resolved = await resolveLatestCampaignRecipientForInbound({
    supabase,
    empresaId,
    channelId,
    phoneDigits,
    inboundMs,
  });

  if (!resolved) {
    console.info(LOG_NONE, {
      empresa_id: empresaId,
      channel_id: channelId,
      contact_id: contactId,
      phone_masked: maskPhoneDigits(phoneDigits),
      reason: "no_recipient_resolve",
      wa_message_id: waMessageId ?? null,
    });
    return { matched: false, reason: "no_recipient_resolve" };
  }

  console.info(LOG_MATCH, {
    empresa_id: empresaId,
    campaign_id: resolved.campaign_id,
    recipient_id: resolved.id,
    contact_id: contactId,
    phone_masked: maskPhoneDigits(phoneDigits),
    wa_message_id: waMessageId ?? null,
  });

  let wasFirstReply = false;
  const pendingFirstReply = resolved.status === "sent" && resolved.first_reply_at == null;

  if (pendingFirstReply) {
    const { data: updatedRows, error: upErr } = await supabase
      .from("chat_campaign_recipients")
      .update({
        status: "replied",
        first_reply_at: inboundTs,
        updated_at: inboundTs,
      })
      .eq("id", resolved.id)
      .eq("empresa_id", empresaId)
      .is("first_reply_at", null)
      .select("id");

    if (upErr) {
      console.warn("[campaign-inbound]", upErr.message);
    } else if (updatedRows && updatedRows.length > 0) {
      wasFirstReply = true;

      await supabase.from("chat_campaign_events").insert({
        empresa_id: empresaId,
        campaign_id: resolved.campaign_id,
        recipient_id: resolved.id,
        event_type: "inbound_reply",
        event_payload_json: {
          contact_id: contactId,
          channel_id: channelId,
          inbound_at: inboundTs,
          reply_preview: (preview ?? "").slice(0, 80),
          wa_message_id: waMessageId ?? null,
        },
      });

      const { data: camp } = await supabase
        .from("chat_campaigns")
        .select("replied_count")
        .eq("id", resolved.campaign_id)
        .eq("empresa_id", empresaId)
        .maybeSingle();

      const rc = (camp as { replied_count?: number } | null)?.replied_count ?? 0;
      await supabase
        .from("chat_campaigns")
        .update({
          replied_count: rc + 1,
          updated_at: inboundTs,
        })
        .eq("id", resolved.campaign_id)
        .eq("empresa_id", empresaId);

      console.info(LOG_MARK, {
        empresa_id: empresaId,
        campaign_id: resolved.campaign_id,
        recipient_id: resolved.id,
        contact_id: contactId,
        phone_masked: maskPhoneDigits(phoneDigits),
        message_id: waMessageId ?? null,
        created_at: inboundTs,
      });
    }
  }

  return {
    matched: true,
    campaignId: resolved.campaign_id,
    recipientId: resolved.id,
    contactId,
    channelId,
    phoneE164: resolved.phone_e164,
    inboundAt: inboundTs,
    wasFirstReply,
  };
}
