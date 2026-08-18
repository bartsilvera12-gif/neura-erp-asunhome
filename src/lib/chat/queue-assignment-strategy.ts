/**
 * Lógica pura compartida entre asignación vía PostgREST (`assign-conversation-service`)
 * y asignación vía pool SQL (`assign-conversation-pg`, webhooks tenant).
 */
export type EligibleAgentForPick = {
  id: string;
  max_conversations: number;
  priority_in_queue: number;
};

export type QueueAssignmentState = { rr_last_agent_id?: string | null };

export function parseAssignmentState(raw: unknown): QueueAssignmentState {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const id = o.rr_last_agent_id;
  return { rr_last_agent_id: typeof id === "string" && id.trim() ? id.trim() : null };
}

export function pickRoundRobin(
  eligible: EligibleAgentForPick[],
  assignmentState: QueueAssignmentState
): EligibleAgentForPick {
  const sorted = [...eligible].sort((a, b) => {
    if (b.priority_in_queue !== a.priority_in_queue) return b.priority_in_queue - a.priority_in_queue;
    return a.id.localeCompare(b.id);
  });
  const ids = sorted.map((a) => a.id);
  const last = assignmentState.rr_last_agent_id?.trim() || "";
  let idx = 0;
  if (last) {
    const pos = ids.indexOf(last);
    if (pos >= 0) idx = (pos + 1) % ids.length;
  }
  return sorted[idx]!;
}

export function pickLeastLoad(
  eligible: EligibleAgentForPick[],
  loadById: Map<string, number>
): EligibleAgentForPick {
  const sorted = [...eligible].sort((a, b) => {
    const la = loadById.get(a.id) ?? 0;
    const lb = loadById.get(b.id) ?? 0;
    if (la !== lb) return la - lb;
    if (b.priority_in_queue !== a.priority_in_queue) return b.priority_in_queue - a.priority_in_queue;
    return a.id.localeCompare(b.id);
  });
  return sorted[0]!;
}
