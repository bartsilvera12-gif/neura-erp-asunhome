import type { SupabaseAdmin } from "@/lib/chat/types";
import { parseQueueRoutingConfig } from "@/lib/chat/queue-routing-config";
import {
  countActiveConversationsByAgent,
  filterAgentsUnderCap,
  loadEligibleAgentsForQueue,
} from "@/lib/chat/routing-eligible-agents";
import { insertChatRoutingEvent, updateContactLastRouted } from "@/lib/chat/routing-audit";

const MAX_INITIAL_REASSIGNS = 15;

function initialNoResponseWindowMs(cfg: { value: number; unit: "minutes" | "hours" }): number {
  const v = Math.max(1, cfg.value);
  return cfg.unit === "hours" ? v * 3600_000 : v * 60_000;
}

export type InitialRedistributeResult = { changed: boolean };

/**
 * Reasignación por falta de primera respuesta humana, evaluada al recibir mensaje del contacto.
 * Solo con `initial_no_response.action === reassign_auto'`.
 */
export async function maybeRedistributeInitialAssignment(
  supabase: SupabaseAdmin,
  conversationId: string
): Promise<InitialRedistributeResult> {
  const cid = conversationId.trim();
  if (!cid) return { changed: false };

  const { data: conv, error: cErr } = await supabase
    .from("chat_conversations")
    .select(
      "id, empresa_id, queue_id, contact_id, channel_id, assigned_agent_id, first_human_response_at, initial_assignment_at, initial_reassign_count"
    )
    .eq("id", cid)
    .maybeSingle();

  if (cErr || !conv?.id) return { changed: false };

  const empresaId = conv.empresa_id as string;
  const assigned = (conv.assigned_agent_id as string | null)?.trim() || null;
  const queueId = (conv.queue_id as string | null)?.trim() || null;
  const firstHuman = conv.first_human_response_at as string | null;
  const initialAt = conv.initial_assignment_at as string | null;
  const reCount = Number(conv.initial_reassign_count ?? 0);

  if (!assigned || firstHuman || !queueId || !initialAt) {
    return { changed: false };
  }

  if (reCount >= MAX_INITIAL_REASSIGNS) {
    await insertChatRoutingEvent(supabase, {
      empresa_id: empresaId,
      conversation_id: cid,
      queue_id: queueId,
      event_type: "reassign_skipped_max_iterations",
      payload: { initial_reassign_count: reCount },
    });
    return { changed: false };
  }

  const { data: queue, error: qErr } = await supabase
    .from("chat_queues")
    .select("id, routing_config, distribution_strategy")
    .eq("id", queueId)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (qErr || !queue?.id) return { changed: false };

  const routing = parseQueueRoutingConfig((queue as { routing_config?: unknown }).routing_config);
  const init = routing.initial_no_response;
  if (!init?.enabled || init.action !== "reassign_auto") {
    return { changed: false };
  }

  const deadline = new Date(initialAt).getTime() + initialNoResponseWindowMs(init);
  if (Date.now() < deadline) {
    return { changed: false };
  }

  const agents = await loadEligibleAgentsForQueue(supabase, empresaId, queueId);
  const loads = await countActiveConversationsByAgent(
    supabase,
    empresaId,
    agents.map((a) => a.id)
  );
  const under = filterAgentsUnderCap(agents, loads).filter((a) => a.id !== assigned);
  if (under.length === 0) {
    await insertChatRoutingEvent(supabase, {
      empresa_id: empresaId,
      conversation_id: cid,
      queue_id: queueId,
      event_type: "reassign_skipped_no_alternate",
      payload: { from_agent_id: assigned, reason: "no_eligible_alternate" },
    });
    return { changed: false };
  }

  under.sort((a, b) => {
    const la = loads.get(a.id) ?? 0;
    const lb = loads.get(b.id) ?? 0;
    if (la !== lb) return la - lb;
    if (b.priority_in_queue !== a.priority_in_queue) return b.priority_in_queue - a.priority_in_queue;
    return a.id.localeCompare(b.id);
  });
  const pick = under[0]!;
  const ts = new Date().toISOString();

  const { error: upErr } = await supabase
    .from("chat_conversations")
    .update({
      assigned_agent_id: pick.id,
      initial_assignment_at: ts,
      initial_reassign_count: reCount + 1,
      assignment_wait_code: null,
      updated_at: ts,
    })
    .eq("id", cid)
    .eq("empresa_id", empresaId);

  if (upErr) {
    console.warn("[initial-redistribution] update", upErr.message);
    return { changed: false };
  }

  await insertChatRoutingEvent(supabase, {
    empresa_id: empresaId,
    conversation_id: cid,
    queue_id: queueId,
    event_type: "reassigned_initial_timeout",
    payload: {
      from_agent_id: assigned,
      to_agent_id: pick.id,
      strategy: (queue as { distribution_strategy?: string }).distribution_strategy ?? null,
      initial_reassign_count: reCount + 1,
    },
  });

  const contactId = (conv.contact_id as string | null)?.trim();
  const channelId = (conv.channel_id as string | null)?.trim();
  if (contactId && channelId) {
    await updateContactLastRouted(supabase, {
      empresa_id: empresaId,
      contact_id: contactId,
      channel_id: channelId,
      chat_agent_id: pick.id,
      at_iso: ts,
    });
  }

  return { changed: true };
}
