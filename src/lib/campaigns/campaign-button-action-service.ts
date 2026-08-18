import "server-only";
import type { SupabaseAdmin } from "@/lib/chat/types";
import { createFlowEngine } from "@/lib/chat/flow-engine-service";
import {
  insertActiveFlowSessionRow,
  markConversationActiveSessionsEnded,
} from "@/lib/chat/flow-session-service";
import { normalizeWaPhone } from "@/lib/chat/wa-phone";
import { resolveLatestCampaignRecipientForInbound } from "@/lib/campaigns/campaign-recipient-resolve";
import {
  FLOW_POINTER_RESET_EVENT,
  getFirstActiveNodeCodeForFlow,
  isFlowKnownAndActiveInCatalog,
  isNodeActiveInFlow,
} from "@/lib/chat/resolve-whatsapp-active-flow";
import {
  resolveOutboundTextContextFromConversationId,
  sendOutboundTextMessage,
} from "@/lib/chat/outbound-send-dispatch";

const LOG_RX = "[campaign-button-action][received]";
const LOG_MT = "[campaign-button-action][matched]";
const LOG_EX = "[campaign-button-action][executed]";
const LOG_NA = "[campaign-button-action][no-action]";
const LOG_ER = "[campaign-button-action][error]";
const LOG_ID = "[campaign-button-action][idempotent-skip]";

const DEBOUNCE_MS = 45_000;

export type CampaignButtonActionRow = {
  id: string;
  empresa_id: string;
  campaign_id: string;
  button_id: string;
  button_label: string | null;
  action_type: "none" | "start_flow" | "send_text";
  flow_code: string | null;
  start_node_code: string | null;
  text_body: string | null;
  metadata: Record<string, unknown>;
};

export function inboundButtonReplyIdFromRaw(raw: Record<string, unknown>): string | null {
  const intr = raw.interactive as
    | { button_reply?: { id?: string }; list_reply?: { id?: string } }
    | undefined;
  if (intr && typeof intr === "object") {
    const id = intr.button_reply?.id?.trim();
    if (id) return id;
    const listId = intr.list_reply?.id?.trim();
    if (listId) return listId;
  }
  /** Meta WhatsApp Cloud: muchos clics de plantilla llegan como `type: "button"` + `button.payload`. */
  const msgType = String(raw.type ?? "").trim().toLowerCase();
  if (msgType === "button") {
    const btn = raw.button as { payload?: string; text?: string } | undefined;
    const id = btn?.payload?.trim() || btn?.text?.trim();
    if (id) return id;
  }
  return null;
}

function inboundButtonReplyTitle(raw: Record<string, unknown>): string | null {
  const intr = raw.interactive as
    | { button_reply?: { title?: string }; list_reply?: { title?: string } }
    | undefined;
  const fromInteractive =
    intr?.button_reply?.title?.trim() || intr?.list_reply?.title?.trim();
  if (fromInteractive) return fromInteractive;
  const msgType = String(raw.type ?? "").trim().toLowerCase();
  if (msgType === "button") {
    const btn = raw.button as { text?: string; payload?: string } | undefined;
    const t = btn?.text?.trim() || btn?.payload?.trim();
    return t || null;
  }
  return null;
}

function inboundPlainTextBody(raw: Record<string, unknown>): string | null {
  const t = String(raw.type ?? "").toLowerCase();
  if (t !== "text") return null;
  const body = (raw as { text?: { body?: string } }).text?.body?.trim();
  return body || null;
}

function normalizeButtonToken(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function actionMatchesInbound(
  action: CampaignButtonActionRow,
  buttonId: string,
  buttonTitle: string | null
): boolean {
  if (action.action_type === "none") return false;
  const nid = normalizeButtonToken(buttonId);
  if (normalizeButtonToken(action.button_id) === nid) return true;
  if (buttonTitle) {
    const nt = normalizeButtonToken(buttonTitle);
    if (normalizeButtonToken(action.button_id) === nt) return true;
    if (action.button_label && normalizeButtonToken(action.button_label) === nt) return true;
  }
  return false;
}

function actionMatchesPlainText(action: CampaignButtonActionRow, text: string): boolean {
  if (action.action_type === "none") return false;
  const nt = normalizeButtonToken(text);
  if (action.button_label && normalizeButtonToken(action.button_label) === nt) return true;
  if (normalizeButtonToken(action.button_id) === nt) return true;
  return false;
}

function idempotencyKeyForInbound(
  buttonId: string | null,
  plainText: string | null,
  buttonTitle: string | null
): string {
  if (buttonId) return buttonId;
  if (plainText) return `text:${normalizeButtonToken(plainText)}`;
  if (buttonTitle) return `title:${normalizeButtonToken(buttonTitle)}`;
  return "";
}

async function loadActionsForCampaign(
  supabase: SupabaseAdmin,
  empresaId: string,
  campaignId: string
): Promise<CampaignButtonActionRow[]> {
  const { data, error } = await supabase
    .from("chat_campaign_button_actions")
    .select("*")
    .eq("empresa_id", empresaId)
    .eq("campaign_id", campaignId);
  if (error) return [];
  return (data ?? []) as CampaignButtonActionRow[];
}

function pickMatchingAction(
  actions: CampaignButtonActionRow[],
  buttonId: string | null,
  buttonTitle: string | null,
  plainText: string | null
): CampaignButtonActionRow | null {
  if (buttonId) {
    const a = actions.find((x) => actionMatchesInbound(x, buttonId, buttonTitle));
    if (a) return a;
  } else if (buttonTitle) {
    const nt = normalizeButtonToken(buttonTitle);
    const a = actions.find(
      (x) =>
        x.action_type !== "none" &&
        ((x.button_label && normalizeButtonToken(x.button_label) === nt) ||
          normalizeButtonToken(x.button_id) === nt)
    );
    if (a) return a;
  }
  if (plainText) {
    const a = actions.find((x) => actionMatchesPlainText(x, plainText));
    if (a) return a;
  }
  return null;
}

async function shouldSkipIdempotent(params: {
  supabase: SupabaseAdmin;
  empresaId: string;
  campaignId: string;
  conversationId: string;
  buttonId: string;
  waMessageId: string | null | undefined;
  actionType: string;
}): Promise<boolean> {
  if (params.waMessageId) {
    const { data: evDup } = await params.supabase
      .from("chat_campaign_events")
      .select("event_payload_json")
      .eq("empresa_id", params.empresaId)
      .eq("campaign_id", params.campaignId)
      .eq("event_type", "campaign_button_action_executed")
      .order("created_at", { ascending: false })
      .limit(40);
    const dupHit = (evDup ?? []).some(
      (row) =>
        String((row.event_payload_json as Record<string, unknown> | undefined)?.wa_message_id ?? "") ===
        params.waMessageId
    );
    if (dupHit) return true;
  }

  const since = new Date(Date.now() - DEBOUNCE_MS).toISOString();
  const { data: recent } = await params.supabase
    .from("chat_campaign_events")
    .select("id, created_at, event_payload_json")
    .eq("empresa_id", params.empresaId)
    .eq("campaign_id", params.campaignId)
    .eq("event_type", "campaign_button_action_executed")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(20);

  for (const ev of recent ?? []) {
    const p = ev.event_payload_json as Record<string, unknown> | null;
    if (!p || typeof p !== "object") continue;
    if (String(p.conversation_id ?? "") !== params.conversationId) continue;
    if (String(p.button_id ?? "") !== params.buttonId) continue;
    if (String(p.action_type ?? "") !== params.actionType) continue;
    return true;
  }

  return false;
}

async function recordExecuted(params: {
  supabase: SupabaseAdmin;
  empresaId: string;
  campaignId: string;
  recipientId: string;
  contactId: string;
  conversationId: string;
  buttonId: string;
  actionType: string;
  flowCode: string | null;
  startNodeCode: string | null;
  waMessageId: string | null;
  detail?: Record<string, unknown>;
}) {
  await params.supabase.from("chat_campaign_events").insert({
    empresa_id: params.empresaId,
    campaign_id: params.campaignId,
    recipient_id: params.recipientId,
    event_type: "campaign_button_action_executed",
    event_payload_json: {
      contact_id: params.contactId,
      conversation_id: params.conversationId,
      button_id: params.buttonId,
      action_type: params.actionType,
      flow_code: params.flowCode,
      start_node_code: params.startNodeCode,
      wa_message_id: params.waMessageId ?? null,
      ...(params.detail ?? {}),
    },
  });
}

async function recordNoAction(params: {
  supabase: SupabaseAdmin;
  empresaId: string;
  campaignId: string;
  recipientId: string;
  reason: string;
  receivedButtonId: string | null;
  receivedButtonTitle: string | null;
  plainText: string | null;
  configuredButtonIds: string[];
}) {
  await params.supabase.from("chat_campaign_events").insert({
    empresa_id: params.empresaId,
    campaign_id: params.campaignId,
    recipient_id: params.recipientId,
    event_type: "campaign_button_action_no_action",
    event_payload_json: {
      reason: params.reason,
      received_button_id: params.receivedButtonId,
      received_button_title: params.receivedButtonTitle,
      plain_text_preview: params.plainText ? params.plainText.slice(0, 120) : null,
      configured_button_ids: params.configuredButtonIds.slice(0, 50),
    },
  });
}

async function recordActionError(params: {
  supabase: SupabaseAdmin;
  empresaId: string;
  campaignId: string;
  recipientId: string;
  reason: string;
  detail?: Record<string, unknown>;
}) {
  await params.supabase.from("chat_campaign_events").insert({
    empresa_id: params.empresaId,
    campaign_id: params.campaignId,
    recipient_id: params.recipientId,
    event_type: "campaign_button_action_error",
    event_payload_json: {
      reason: params.reason,
      ...(params.detail ?? {}),
    },
  });
}

/**
 * Ejecuta la acción configurada para la campaña/recipient ya resueltos por `markCampaignReplyFromInbound`
 * (misma fila que RESPONDIERON). No re-busca recipient por teléfono.
 */
export async function executeCampaignButtonActionForMatchedRecipient(params: {
  supabase: SupabaseAdmin;
  empresaId: string;
  channelId: string;
  conversationId: string;
  contactId: string;
  campaignId: string;
  recipientId: string;
  inboundAtIso: string;
  waMessageId?: string | null;
  rawPayload: Record<string, unknown>;
}): Promise<{ handled: boolean }> {
  const buttonId = inboundButtonReplyIdFromRaw(params.rawPayload);
  const buttonTitle = inboundButtonReplyTitle(params.rawPayload);
  const plainText = inboundPlainTextBody(params.rawPayload);
  const idempotencyKey = idempotencyKeyForInbound(buttonId, plainText, buttonTitle);

  if (!idempotencyKey) {
    const intr = params.rawPayload.interactive as { button_reply?: unknown } | undefined;
    if (intr?.button_reply) {
      console.info(LOG_NA, {
        reason: "missing_button_reply_id_and_title",
        empresa_id: params.empresaId,
        campaign_id: params.campaignId,
      });
    }
    return { handled: false };
  }

  console.info(LOG_RX, {
    empresa_id: params.empresaId,
    campaign_id: params.campaignId,
    recipient_id: params.recipientId,
    conversation_id: params.conversationId,
    contact_id: params.contactId,
    received_button_id: buttonId,
    received_button_title: buttonTitle,
    plain_text_used: plainText ? plainText.slice(0, 80) : null,
    wa_message_id: params.waMessageId ?? null,
  });

  const actions = await loadActionsForCampaign(
    params.supabase,
    params.empresaId,
    params.campaignId
  );
  const configuredIds = actions.map((a) => a.button_id);

  const action = pickMatchingAction(actions, buttonId, buttonTitle, plainText);

  if (!action || action.action_type === "none") {
    console.info(LOG_NA, {
      empresa_id: params.empresaId,
      campaign_id: params.campaignId,
      recipient_id: params.recipientId,
      received_button_id: buttonId,
      received_button_title: buttonTitle,
      plain_text: plainText ? plainText.slice(0, 80) : null,
      configured_button_ids: configuredIds,
      reason: !action ? "no_matching_action" : "action_none",
    });
    await recordNoAction({
      supabase: params.supabase,
      empresaId: params.empresaId,
      campaignId: params.campaignId,
      recipientId: params.recipientId,
      reason: !action ? "no_matching_action" : "action_none",
      receivedButtonId: buttonId,
      receivedButtonTitle: buttonTitle,
      plainText,
      configuredButtonIds: configuredIds,
    });
    return { handled: false };
  }

  const logicalButtonId = action.button_id;

  console.info(LOG_MT, {
    empresa_id: params.empresaId,
    campaign_id: params.campaignId,
    recipient_id: params.recipientId,
    contact_id: params.contactId,
    button_id: logicalButtonId,
    action_type: action.action_type,
    flow_code: action.flow_code ?? null,
    start_node_code: action.start_node_code ?? null,
  });

  const skip = await shouldSkipIdempotent({
    supabase: params.supabase,
    empresaId: params.empresaId,
    campaignId: params.campaignId,
    conversationId: params.conversationId,
    buttonId: logicalButtonId,
    waMessageId: params.waMessageId,
    actionType: action.action_type,
  });

  if (skip) {
    console.info(LOG_ID, {
      empresa_id: params.empresaId,
      campaign_id: params.campaignId,
      recipient_id: params.recipientId,
      button_id: logicalButtonId,
      action_type: action.action_type,
    });
    return {
      handled: action.action_type === "start_flow" || action.action_type === "send_text",
    };
  }

  try {
    if (action.action_type === "send_text") {
      const body = String(action.text_body ?? "").trim();
      const ctx = await resolveOutboundTextContextFromConversationId(
        params.supabase,
        params.conversationId,
        params.empresaId
      );
      const send = await sendOutboundTextMessage(ctx, body.slice(0, 4096));
      if (!send.ok) {
        console.warn(LOG_ER, {
          empresa_id: params.empresaId,
          campaign_id: params.campaignId,
          error: send.error ?? "send_failed",
        });
        await recordActionError({
          supabase: params.supabase,
          empresaId: params.empresaId,
          campaignId: params.campaignId,
          recipientId: params.recipientId,
          reason: "send_text_failed",
          detail: { error: send.error ?? null },
        });
        return { handled: false };
      }
      await recordExecuted({
        supabase: params.supabase,
        empresaId: params.empresaId,
        campaignId: params.campaignId,
        recipientId: params.recipientId,
        contactId: params.contactId,
        conversationId: params.conversationId,
        buttonId: logicalButtonId,
        actionType: "send_text",
        flowCode: null,
        startNodeCode: null,
        waMessageId: params.waMessageId ?? null,
        detail: { outbound_ok: true },
      });
      console.info(LOG_EX, {
        empresa_id: params.empresaId,
        campaign_id: params.campaignId,
        recipient_id: params.recipientId,
        contact_id: params.contactId,
        button_id: logicalButtonId,
        action_type: "send_text",
      });
      return { handled: true };
    }

    if (action.action_type === "start_flow") {
      const fc = String(action.flow_code ?? "").trim();
      if (!(await isFlowKnownAndActiveInCatalog(params.supabase, params.empresaId, fc))) {
        console.warn(LOG_ER, {
          empresa_id: params.empresaId,
          campaign_id: params.campaignId,
          flow_code: fc,
          reason: "flow_not_active",
        });
        await recordActionError({
          supabase: params.supabase,
          empresaId: params.empresaId,
          campaignId: params.campaignId,
          recipientId: params.recipientId,
          reason: "flow_not_active",
          detail: { flow_code: fc },
        });
        return { handled: false };
      }

      let nodeCode = String(action.start_node_code ?? "").trim();
      if (nodeCode) {
        const okNode = await isNodeActiveInFlow(params.supabase, params.empresaId, fc, nodeCode);
        if (!okNode) {
          console.warn(LOG_ER, {
            empresa_id: params.empresaId,
            flow_code: fc,
            start_node_code: nodeCode,
            reason: "node_not_active",
          });
          await recordActionError({
            supabase: params.supabase,
            empresaId: params.empresaId,
            campaignId: params.campaignId,
            recipientId: params.recipientId,
            reason: "node_not_active",
            detail: { flow_code: fc, start_node_code: nodeCode },
          });
          return { handled: false };
        }
      } else {
        nodeCode =
          (await getFirstActiveNodeCodeForFlow(params.supabase, params.empresaId, fc)) ?? "inicio";
      }

      await markConversationActiveSessionsEnded(
        params.supabase,
        params.empresaId,
        params.conversationId,
        "restarted",
        "campaign_button_action"
      );

      const newSid = await insertActiveFlowSessionRow(
        params.supabase,
        params.empresaId,
        params.conversationId,
        fc
      );

      if (!newSid) {
        console.warn(LOG_ER, {
          empresa_id: params.empresaId,
          campaign_id: params.campaignId,
          reason: "session_insert_failed",
        });
        await recordActionError({
          supabase: params.supabase,
          empresaId: params.empresaId,
          campaignId: params.campaignId,
          recipientId: params.recipientId,
          reason: "session_insert_failed",
        });
        return { handled: false };
      }

      const { error: upErr } = await params.supabase
        .from("chat_conversations")
        .update({
          flow_code: fc,
          flow_current_node: nodeCode,
          flow_status: "bot",
          human_taken_over: false,
          active_flow_session_id: newSid,
          updated_at: new Date().toISOString(),
        })
        .eq("id", params.conversationId)
        .eq("empresa_id", params.empresaId);

      if (upErr) {
        console.warn(LOG_ER, {
          empresa_id: params.empresaId,
          message: upErr.message,
          reason: "conversation_update_failed",
        });
        await recordActionError({
          supabase: params.supabase,
          empresaId: params.empresaId,
          campaignId: params.campaignId,
          recipientId: params.recipientId,
          reason: "conversation_update_failed",
          detail: { message: upErr.message },
        });
        return { handled: false };
      }

      await params.supabase.from("chat_flow_events").insert({
        empresa_id: params.empresaId,
        conversation_id: params.conversationId,
        flow_code: fc,
        node_code: nodeCode,
        flow_session_id: newSid,
        event_type: FLOW_POINTER_RESET_EVENT,
        payload: {
          trigger: "campaign_button_action",
          flow_session_id: newSid,
          campaign_id: params.campaignId,
          button_id: logicalButtonId,
        },
      });

      const engine = createFlowEngine({ supabase: params.supabase });
      const sent = await engine.sendCurrentFlowNode({ conversationId: params.conversationId });
      if (!sent.ok) {
        console.warn(LOG_ER, {
          empresa_id: params.empresaId,
          campaign_id: params.campaignId,
          error: sent.error ?? "sendCurrentFlowNode",
        });
        await recordActionError({
          supabase: params.supabase,
          empresaId: params.empresaId,
          campaignId: params.campaignId,
          recipientId: params.recipientId,
          reason: "sendCurrentFlowNode_failed",
          detail: { error: sent.error ?? null },
        });
      }

      await recordExecuted({
        supabase: params.supabase,
        empresaId: params.empresaId,
        campaignId: params.campaignId,
        recipientId: params.recipientId,
        contactId: params.contactId,
        conversationId: params.conversationId,
        buttonId: logicalButtonId,
        actionType: "start_flow",
        flowCode: fc,
        startNodeCode: nodeCode,
        waMessageId: params.waMessageId ?? null,
        detail: { flow_engine_ok: sent.ok },
      });

      console.info(LOG_EX, {
        empresa_id: params.empresaId,
        campaign_id: params.campaignId,
        recipient_id: params.recipientId,
        contact_id: params.contactId,
        button_id: logicalButtonId,
        action_type: "start_flow",
        flow_code: fc,
        start_node_code: nodeCode,
      });

      return { handled: true };
    }
  } catch (e) {
    console.warn(LOG_ER, {
      empresa_id: params.empresaId,
      campaign_id: params.campaignId,
      err: e instanceof Error ? e.message : String(e),
    });
    await recordActionError({
      supabase: params.supabase,
      empresaId: params.empresaId,
      campaignId: params.campaignId,
      recipientId: params.recipientId,
      reason: "exception",
      detail: { message: e instanceof Error ? e.message : String(e) },
    });
    return { handled: false };
  }

  return { handled: false };
}

/**
 * Compatibilidad: resuelve recipient + ejecuta (sin pasar por mark). Preferir mark + execute en webhooks.
 */
export async function tryHandleCampaignButtonAction(params: {
  supabase: SupabaseAdmin;
  empresaId: string;
  channelId: string;
  conversationId: string;
  contactId: string;
  inboundAtIso: string;
  waMessageId?: string | null;
  rawPayload: Record<string, unknown>;
}): Promise<{ handled: boolean }> {
  const { data: contact, error: cErr } = await params.supabase
    .from("chat_contacts")
    .select("phone_number")
    .eq("id", params.contactId)
    .eq("empresa_id", params.empresaId)
    .maybeSingle();

  if (cErr || !contact) {
    console.info(LOG_NA, { reason: "contact_not_found", empresa_id: params.empresaId });
    return { handled: false };
  }

  const phoneDigits = normalizeWaPhone((contact as { phone_number?: string }).phone_number ?? "");
  if (!phoneDigits) {
    console.info(LOG_NA, { reason: "contact_phone_empty", empresa_id: params.empresaId });
    return { handled: false };
  }

  const inboundMs = Date.parse(params.inboundAtIso);
  if (Number.isNaN(inboundMs)) {
    console.info(LOG_NA, { reason: "bad_inbound_ts", empresa_id: params.empresaId });
    return { handled: false };
  }

  const resolved = await resolveLatestCampaignRecipientForInbound({
    supabase: params.supabase,
    empresaId: params.empresaId,
    channelId: params.channelId,
    phoneDigits,
    inboundMs,
  });

  if (!resolved) {
    console.info(LOG_NA, {
      reason: "legacy_resolve_failed",
      empresa_id: params.empresaId,
      channel_id: params.channelId,
    });
    return { handled: false };
  }

  return executeCampaignButtonActionForMatchedRecipient({
    supabase: params.supabase,
    empresaId: params.empresaId,
    channelId: params.channelId,
    conversationId: params.conversationId,
    contactId: params.contactId,
    campaignId: resolved.campaign_id,
    recipientId: resolved.id,
    inboundAtIso: params.inboundAtIso,
    waMessageId: params.waMessageId,
    rawPayload: params.rawPayload,
  });
}
