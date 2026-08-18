import type { Pool } from "pg";
import type { AssignConversationResult } from "@/lib/chat/assign-conversation-service";
import { isAgentSessionOnline } from "@/lib/chat/agent-presence";
import { parseAssignmentState, pickLeastLoad, pickRoundRobin } from "@/lib/chat/queue-assignment-strategy";
import { quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { parseQueueRoutingConfig } from "@/lib/chat/queue-routing-config";

type QueueRow = {
  id: string;
  channel_type: string | null;
  nombre: string;
  distribution_strategy: string;
  priority: number;
  routing_config: unknown;
  assignment_state: unknown;
};

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

const ACTIVE = ["open", "pending"];

/**
 * Asignación automática mínima vía Postgres (schemas tenant no expuestos en PostgREST).
 * Cubre cola vinculada → cola por tipo → primer agente elegible bajo tope de carga.
 */
export async function assignConversationPg(
  pool: Pool,
  schema: string,
  conversationId: string
): Promise<AssignConversationResult> {
  const sch = assertAllowedChatDataSchema(schema);
  const cid = conversationId.trim();
  if (!cid) return { ok: false, error: "conversation_id vacío" };

  const convT = quoteSchemaTable(sch, "chat_conversations");
  const chT = quoteSchemaTable(sch, "chat_channels");
  const qT = quoteSchemaTable(sch, "chat_queues");
  const linkT = quoteSchemaTable(sch, "chat_queue_channels");
  const agT = quoteSchemaTable(sch, "chat_agents");

  const convRes = await pool.query(
    `SELECT id, empresa_id, channel_id, contact_id, assigned_agent_id
     FROM ${convT}
     WHERE id = $1::uuid
     LIMIT 1`,
    [cid]
  );
  const conv = convRes.rows[0] as
    | {
        id: string;
        empresa_id: string;
        channel_id: string;
        contact_id: string;
        assigned_agent_id: string | null;
      }
    | undefined;
  if (!conv) return { ok: false, error: "Conversación no encontrada" };
  if (conv.assigned_agent_id) {
    return { ok: true, assigned: false, reason: "already_assigned" };
  }

  const empresaId = conv.empresa_id;
  const channelId = conv.channel_id;

  const chRow = await pool.query(`SELECT type FROM ${chT} WHERE id = $1::uuid AND empresa_id = $2::uuid LIMIT 1`, [
    channelId,
    empresaId,
  ]);
  const channelType = ((chRow.rows[0] as { type?: string } | undefined)?.type as string) ?? "whatsapp";

  const qRes = await pool.query(
    `SELECT id, channel_type, nombre, distribution_strategy, priority, routing_config, assignment_state
     FROM ${qT}
     WHERE empresa_id = $1::uuid AND is_active = true`,
    [empresaId]
  );
  const allQueues = (qRes.rows ?? []) as QueueRow[];

  let queue: QueueRow | null = null;
  const linkRes = await pool.query(
    `SELECT queue_id FROM ${linkT} WHERE empresa_id = $1::uuid AND channel_id = $2::uuid`,
    [empresaId, channelId]
  );
  const qids = [...new Set((linkRes.rows ?? []).map((r) => String((r as { queue_id: string }).queue_id)).filter(Boolean))];
  if (qids.length > 0) {
    const linked = allQueues.filter((q) => qids.includes(q.id));
    queue = pickFromLinkedQueues(linked);
  }
  if (!queue) queue = pickQueueForChannel(allQueues, channelType);
  if (!queue) return { ok: true, assigned: false, reason: "no_queue" };

  const distributionStrategy = String(queue.distribution_strategy ?? "").trim();

  if (distributionStrategy === "manual_pull") {
    const ts = new Date().toISOString();
    await pool.query(
      `UPDATE ${convT}
       SET queue_id = $1::uuid,
           initial_assignment_at = NULL,
           first_human_response_at = NULL,
           assignment_wait_code = 'manual_queue',
           updated_at = $2::timestamptz
       WHERE id = $3::uuid AND empresa_id = $4::uuid`,
      [queue.id, ts, cid, empresaId]
    );
    return { ok: true, assigned: false, reason: "manual_pull" };
  }

  const agentsRes = await pool.query(
    `SELECT id, usuario_id, max_conversations, priority_in_queue, operational_status, last_heartbeat_at
     FROM ${agT}
     WHERE empresa_id = $1::uuid AND queue_id = $2::uuid
       AND is_active = true AND receives_new_chats = true
     ORDER BY priority_in_queue DESC, id ASC`,
    [empresaId, queue.id]
  );
  const agentRows = agentsRes.rows as {
    id: string;
    usuario_id: string;
    max_conversations: number;
    priority_in_queue: number;
    operational_status: string | null;
    last_heartbeat_at: string | Date | null;
  }[];

  const uoT = quoteSchemaTable(sch, "chat_usuario_omnicanal");
  const uidList = [...new Set(agentRows.map((a) => String(a.usuario_id ?? "").trim()).filter(Boolean))];
  let omnicanalEnabled = new Set<string>();
  if (uidList.length > 0) {
    try {
      const prefRes = await pool.query(
        `SELECT usuario_id::text AS uid FROM ${uoT}
         WHERE empresa_id = $1::uuid AND omnicanal_agent_enabled = true
           AND usuario_id = ANY($2::uuid[])`,
        [empresaId, uidList]
      );
      omnicanalEnabled = new Set((prefRes.rows ?? []).map((r: { uid: string }) => r.uid));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("does not exist") || msg.includes("undefined_table")) {
        omnicanalEnabled = new Set(uidList);
      } else {
        console.warn("[assignConversationPg] chat_usuario_omnicanal:", msg);
        omnicanalEnabled = new Set(uidList);
      }
    }
  }

  const assignDbg = process.env.OMNICANAL_ASSIGN_DEBUG === "1";
  const idShort = (id: string) => id.slice(0, 8);

  let discardedPause = 0;
  let discardedOffline = 0;
  let discardedOmnicanal = 0;
  const agents: { id: string; max_conversations: number; priority_in_queue: number }[] = [];
  for (const ar of agentRows) {
    const status = String(ar.operational_status ?? "").trim();
    if (status !== "ready") {
      discardedPause++;
      if (assignDbg) console.info(`[assignConversationPg] discard pause agent=${idShort(ar.id)}`);
      continue;
    }
    if (!isAgentSessionOnline(ar.last_heartbeat_at)) {
      discardedOffline++;
      if (assignDbg) console.info(`[assignConversationPg] discard offline agent=${idShort(ar.id)}`);
      continue;
    }
    const uCur = String(ar.usuario_id ?? "").trim();
    if (!uCur || !omnicanalEnabled.has(uCur)) {
      discardedOmnicanal++;
      if (assignDbg) console.info(`[assignConversationPg] discard omnicanal_disabled agent=${idShort(ar.id)}`);
      continue;
    }
    agents.push({
      id: ar.id,
      max_conversations: ar.max_conversations,
      priority_in_queue: ar.priority_in_queue,
    });
  }

  if (agents.length === 0) {
    const ts = new Date().toISOString();
    await pool.query(
      `UPDATE ${convT}
       SET queue_id = $1::uuid,
           initial_assignment_at = NULL,
           assignment_wait_code = 'no_eligible_agent',
           updated_at = $2::timestamptz
       WHERE id = $3::uuid AND empresa_id = $4::uuid`,
      [queue.id, ts, cid, empresaId]
    );
    if (agentRows.length > 0) {
      console.info("[assignConversationPg] no_agent", {
        conversation_id: cid,
        queue_id: queue.id,
        total_in_queue: agentRows.length,
        discarded_pause: discardedPause,
        discarded_offline: discardedOffline,
        discarded_omnicanal_disabled: discardedOmnicanal,
      });
    }
    return { ok: true, assigned: false, reason: "no_agent" };
  }

  const agentIds = agents.map((a) => a.id);
  const loadRes = await pool.query(
    `SELECT assigned_agent_id::text AS id, count(*)::int AS c
     FROM ${convT}
     WHERE empresa_id = $1::uuid AND assigned_agent_id = ANY($2::uuid[]) AND status = ANY($3::text[])
     GROUP BY assigned_agent_id`,
    [empresaId, agentIds, ACTIVE]
  );
  const loadById = new Map<string, number>();
  for (const row of loadRes.rows ?? []) {
    loadById.set(String((row as { id: string }).id), Number((row as { c: number }).c));
  }

  const eligible = agents.filter((a) => {
    const load = loadById.get(a.id) ?? 0;
    const cap = Math.max(1, a.max_conversations ?? 5);
    if (load >= cap) {
      if (assignDbg) console.info(`[assignConversationPg] discard load agent=${idShort(a.id)} load=${load} cap=${cap}`);
      return false;
    }
    return true;
  });
  if (eligible.length === 0) {
    const ts = new Date().toISOString();
    await pool.query(
      `UPDATE ${convT}
       SET queue_id = $1::uuid,
           initial_assignment_at = NULL,
           assignment_wait_code = 'no_eligible_agent',
           updated_at = $2::timestamptz
       WHERE id = $3::uuid AND empresa_id = $4::uuid`,
      [queue.id, ts, cid, empresaId]
    );
    console.info("[assignConversationPg] no_agent_all_at_capacity", {
      conversation_id: cid,
      queue_id: queue.id,
      candidates_ready_online: agents.length,
    });
    return { ok: true, assigned: false, reason: "no_agent" };
  }

  const routing = parseQueueRoutingConfig(queue.routing_config);
  const sa = routing.same_advisor_window;
  let sameAdvisorPick: (typeof eligible)[0] | null = null;
  if (sa?.enabled && conv.contact_id && channelId) {
    const ctRes = await pool.query(
      `SELECT last_routed_chat_agent_id, last_routed_at, last_routed_channel_id
       FROM ${quoteSchemaTable(sch, "chat_contacts")}
       WHERE id = $1::uuid AND empresa_id = $2::uuid`,
      [conv.contact_id, empresaId]
    );
    const cRow = ctRes.rows[0] as
      | {
          last_routed_chat_agent_id: string | null;
          last_routed_at: string | null;
          last_routed_channel_id: string | null;
        }
      | undefined;
    if (cRow?.last_routed_chat_agent_id && cRow.last_routed_at) {
      const lastCh = (cRow.last_routed_channel_id ?? "").trim();
      const channelOk = !lastCh || lastCh === channelId;
      const t0 = new Date(cRow.last_routed_at).getTime();
      const windowMs =
        sa.unit === "days" ? Math.max(1, sa.value) * 86_400_000 : Math.max(1, sa.value) * 3_600_000;
      if (channelOk && !Number.isNaN(t0) && Date.now() - t0 <= windowMs) {
        const hit = eligible.find((a) => a.id === cRow.last_routed_chat_agent_id);
        if (hit) sameAdvisorPick = hit;
      }
    }
  }

  let best: (typeof eligible)[0];
  if (sameAdvisorPick) {
    best = sameAdvisorPick;
  } else if (distributionStrategy === "round_robin") {
    best = pickRoundRobin(eligible, parseAssignmentState(queue.assignment_state));
  } else {
    best = pickLeastLoad(eligible, loadById);
  }

  const ts = new Date().toISOString();
  await pool.query(
    `UPDATE ${convT}
     SET queue_id = $1::uuid,
         assigned_agent_id = $2::uuid,
         initial_assignment_at = $3::timestamptz,
         first_human_response_at = NULL,
         initial_reassign_count = 0,
         assignment_wait_code = NULL,
         updated_at = $3::timestamptz
     WHERE id = $4::uuid AND empresa_id = $5::uuid`,
    [queue.id, best.id, ts, cid, empresaId]
  );

  if (conv.contact_id && channelId) {
    await pool.query(
      `UPDATE ${quoteSchemaTable(sch, "chat_contacts")}
       SET last_routed_chat_agent_id = $1::uuid,
           last_routed_at = $2::timestamptz,
           last_routed_channel_id = $3::uuid,
           updated_at = $2::timestamptz
       WHERE id = $4::uuid AND empresa_id = $5::uuid`,
      [best.id, ts, channelId, conv.contact_id, empresaId]
    );
  }

  if (distributionStrategy === "round_robin") {
    const rawSt = queue.assignment_state;
    const merged: Record<string, unknown> =
      rawSt != null && typeof rawSt === "object" && !Array.isArray(rawSt)
        ? { ...(rawSt as Record<string, unknown>) }
        : {};
    merged.rr_last_agent_id = best.id;
    try {
      await pool.query(
        `UPDATE ${qT} SET assignment_state = $1::jsonb, updated_at = $2::timestamptz WHERE id = $3::uuid AND empresa_id = $4::uuid`,
        [JSON.stringify(merged), ts, queue.id, empresaId]
      );
    } catch (e) {
      console.warn("[assignConversationPg] assignment_state", e);
    }
  }

  return { ok: true, assigned: true, agent_id: best.id, queue_id: queue.id };
}
