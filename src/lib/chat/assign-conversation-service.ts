/**
 * Motor de asignación: cola por canal (vínculos + legado), estrategias circular / menor carga / manual,
 * ventana “mismo asesor” (ancla: última asignación registrada en el contacto por canal) y auditoría.
 */
import type { SupabaseAdmin } from "@/lib/chat/types";
import { parseQueueRoutingConfig } from "@/lib/chat/queue-routing-config";
import {
  parseAssignmentState,
  pickLeastLoad,
  pickRoundRobin,
  type EligibleAgentForPick,
} from "@/lib/chat/queue-assignment-strategy";
import {
  countActiveConversationsByAgent,
  filterAgentsUnderCap,
  loadEligibleAgentsForQueue,
} from "@/lib/chat/routing-eligible-agents";
import { insertChatRoutingEvent, updateContactLastRouted } from "@/lib/chat/routing-audit";

export type AssignConversationResult =
  | { ok: true; assigned: false; reason: "already_assigned" | "no_queue" | "no_agent" | "manual_pull" }
  | { ok: true; assigned: true; agent_id: string; queue_id: string }
  | { ok: false; error: string };

type QueueRow = {
  id: string;
  channel_type: string | null;
  nombre: string;
  distribution_strategy: string;
  priority: number;
  routing_config?: unknown;
  assignment_state?: unknown;
};

type EligibleAgent = EligibleAgentForPick;

function pickQueueForChannel(queues: QueueRow[], channelType: string): QueueRow | null {
  const t = channelType.trim().toLowerCase();
  const matching = queues.filter((q) => !q.channel_type || q.channel_type === t);
  if (matching.length === 0) return null;
  matching.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    const aSpec = a.channel_type ? 0 : 1;
    const bSpec = b.channel_type ? 0 : 1;
    if (aSpec !== bSpec) return aSpec - bSpec;
    return a.nombre.localeCompare(b.nombre, "es");
  });
  return matching[0] ?? null;
}

function pickFromLinkedQueues(linked: QueueRow[]): QueueRow | null {
  if (linked.length === 0) return null;
  const copy = [...linked];
  copy.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.nombre.localeCompare(b.nombre, "es");
  });
  return copy[0] ?? null;
}

function sameAdvisorWindowMs(value: number, unit: "hours" | "days"): number {
  const v = Math.max(1, value);
  return unit === "days" ? v * 86_400_000 : v * 3_600_000;
}

/**
 * Resuelve cola por empresa + canal, elige agente elegible y actualiza `queue_id` / `assigned_agent_id`.
 * Idempotente si ya hay agente asignado.
 */
export async function assignConversation(
  supabase: SupabaseAdmin,
  conversationId: string
): Promise<AssignConversationResult> {
  const cid = conversationId.trim();
  if (!cid) return { ok: false, error: "conversation_id vacío" };

  const { data: conv, error: convErr } = await supabase
    .from("chat_conversations")
    .select(
      "id, empresa_id, channel_id, contact_id, assigned_agent_id, created_at, initial_reassign_count"
    )
    .eq("id", cid)
    .maybeSingle();

  if (convErr) return { ok: false, error: convErr.message };
  if (!conv?.id) return { ok: false, error: "Conversación no encontrada" };

  if (conv.assigned_agent_id) {
    return { ok: true, assigned: false, reason: "already_assigned" };
  }

  const empresaId = conv.empresa_id as string;
  const contactId = ((conv.contact_id as string | null | undefined) ?? "").trim();
  const channelId = ((conv.channel_id as string | null | undefined) ?? "").trim();

  let channelType = "whatsapp";
  if (channelId) {
    const { data: chRow, error: chErr } = await supabase
      .from("chat_channels")
      .select("type")
      .eq("id", channelId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (chErr) return { ok: false, error: chErr.message };
    channelType = ((chRow as { type?: string | null } | null)?.type as string) ?? "whatsapp";
  }

  const { data: queues, error: qErr } = await supabase
    .from("chat_queues")
    .select(
      "id, channel_type, nombre, distribution_strategy, priority, routing_config, assignment_state"
    )
    .eq("empresa_id", empresaId)
    .eq("is_active", true);

  if (qErr) return { ok: false, error: qErr.message };
  const allQueues = (queues ?? []) as QueueRow[];

  let queue: QueueRow | null = null;

  if (channelId) {
    const { data: linkRows, error: lErr } = await supabase
      .from("chat_queue_channels")
      .select("queue_id")
      .eq("empresa_id", empresaId)
      .eq("channel_id", channelId);
    if (lErr) return { ok: false, error: lErr.message };
    const qids = [...new Set((linkRows ?? []).map((r) => r.queue_id as string).filter(Boolean))];
    if (qids.length > 0) {
      const linked = allQueues.filter((q) => qids.includes(q.id));
      queue = pickFromLinkedQueues(linked);
    }
  }

  if (!queue) {
    queue = pickQueueForChannel(allQueues, channelType);
  }

  if (!queue) {
    await insertChatRoutingEvent(supabase, {
      empresa_id: empresaId,
      conversation_id: cid,
      queue_id: null,
      event_type: "no_queue",
      payload: { channel_id: channelId || null, channel_type: channelType },
    });
    return { ok: true, assigned: false, reason: "no_queue" };
  }

  const routing = parseQueueRoutingConfig(queue.routing_config);
  const assignState = parseAssignmentState(queue.assignment_state);
  const distributionStrategy = String(queue.distribution_strategy ?? "").trim();

  if (distributionStrategy === "manual_pull") {
    const ts = new Date().toISOString();
    const { error: upQ } = await supabase
      .from("chat_conversations")
      .update({
        queue_id: queue.id,
        initial_assignment_at: null,
        first_human_response_at: null,
        assignment_wait_code: "manual_queue",
        updated_at: ts,
      })
      .eq("id", cid)
      .eq("empresa_id", empresaId);
    if (upQ) return { ok: false, error: upQ.message };
    await insertChatRoutingEvent(supabase, {
      empresa_id: empresaId,
      conversation_id: cid,
      queue_id: queue.id,
      event_type: "manual_queue_only",
      payload: { strategy: "manual_pull" },
    });
    return { ok: true, assigned: false, reason: "manual_pull" };
  }

  let agents: EligibleAgent[] = [];
  try {
    agents = await loadEligibleAgentsForQueue(supabase, empresaId, queue.id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error agentes" };
  }

  let loadById = new Map<string, number>();
  try {
    loadById = await countActiveConversationsByAgent(
      supabase,
      empresaId,
      agents.map((a) => a.id)
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error carga" };
  }

  const eligible = filterAgentsUnderCap(agents, loadById);

  /** Misma asesor: ancla = última asignación persistida en el contacto para este canal (last_routed_at). */
  let sameAdvisorPick: EligibleAgent | null = null;
  const sa = routing.same_advisor_window;
  if (sa?.enabled && contactId && channelId) {
    const { data: cRow, error: ctErr } = await supabase
      .from("chat_contacts")
      .select("last_routed_chat_agent_id, last_routed_at, last_routed_channel_id")
      .eq("id", contactId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!ctErr && cRow) {
      const lastAgent = (cRow as { last_routed_chat_agent_id?: string | null }).last_routed_chat_agent_id?.trim() ?? "";
      const lastAt = (cRow as { last_routed_at?: string | null }).last_routed_at;
      const lastCh = (cRow as { last_routed_channel_id?: string | null }).last_routed_channel_id?.trim() ?? "";
      const channelOk = !lastCh || lastCh === channelId;
      if (lastAgent && lastAt && channelOk) {
        const t0 = new Date(lastAt).getTime();
        if (!Number.isNaN(t0) && Date.now() - t0 <= sameAdvisorWindowMs(sa.value, sa.unit)) {
          const hit = eligible.find((a) => a.id === lastAgent);
          if (hit) sameAdvisorPick = hit;
        }
      }
    }
  }

  if (eligible.length === 0) {
    const ts = new Date().toISOString();
    const { error: upQ } = await supabase
      .from("chat_conversations")
      .update({
        queue_id: queue.id,
        initial_assignment_at: null,
        assignment_wait_code: "no_eligible_agent",
        updated_at: ts,
      })
      .eq("id", cid)
      .eq("empresa_id", empresaId);
    if (upQ) return { ok: false, error: upQ.message };
    await insertChatRoutingEvent(supabase, {
      empresa_id: empresaId,
      conversation_id: cid,
      queue_id: queue.id,
      event_type: "no_eligible_agent",
      payload: { strategy: distributionStrategy },
    });
    return { ok: true, assigned: false, reason: "no_agent" };
  }

  let best: EligibleAgent;

  if (sameAdvisorPick) {
    best = sameAdvisorPick;
  } else if (distributionStrategy === "round_robin") {
    best = pickRoundRobin(eligible, assignState);
  } else {
    best = pickLeastLoad(eligible, loadById);
  }

  const ts = new Date().toISOString();
  const { error: upErr } = await supabase
    .from("chat_conversations")
    .update({
      queue_id: queue.id,
      assigned_agent_id: best.id,
      initial_assignment_at: ts,
      first_human_response_at: null,
      initial_reassign_count: 0,
      assignment_wait_code: null,
      updated_at: ts,
    })
    .eq("id", cid)
    .eq("empresa_id", empresaId);

  if (upErr) return { ok: false, error: upErr.message };

  if (distributionStrategy === "round_robin") {
    const rawSt = queue.assignment_state;
    const merged: Record<string, unknown> =
      rawSt != null && typeof rawSt === "object" && !Array.isArray(rawSt)
        ? { ...(rawSt as Record<string, unknown>) }
        : {};
    merged.rr_last_agent_id = best.id;
    const { error: stErr } = await supabase
      .from("chat_queues")
      .update({
        assignment_state: merged,
        updated_at: ts,
      })
      .eq("id", queue.id)
      .eq("empresa_id", empresaId);
    if (stErr) console.warn("[assignConversation] assignment_state", stErr.message);
  }

  if (contactId && channelId) {
    await updateContactLastRouted(supabase, {
      empresa_id: empresaId,
      contact_id: contactId,
      channel_id: channelId,
      chat_agent_id: best.id,
      at_iso: ts,
    });
  }

  await insertChatRoutingEvent(supabase, {
    empresa_id: empresaId,
    conversation_id: cid,
    queue_id: queue.id,
    event_type: sameAdvisorPick ? "same_advisor_route" : "assigned_auto",
    payload: {
      strategy: distributionStrategy,
      to_agent_id: best.id,
      same_advisor: Boolean(sameAdvisorPick),
    },
  });

  return { ok: true, assigned: true, agent_id: best.id, queue_id: queue.id };
}
