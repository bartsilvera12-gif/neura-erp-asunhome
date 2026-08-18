import type { SupabaseAdmin } from "@/lib/chat/types";
import type { PurchaseCondition } from "@/lib/chat/recontact-rules-validation";
import {
  RECONTACT_DRY_RUN_CONVERSATION_LIMIT,
  type RecontactDryRunResult,
  type RecontactDryRunRow,
  type RecontactDryRunSkipReason,
  maskChatPhone,
} from "@/lib/chat/recontact-dry-run-shared";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import type { Pool } from "pg";

export {
  RECONTACT_DRY_RUN_CONVERSATION_LIMIT,
  RECONTACT_DRY_RUN_SKIP_LABELS,
  maskChatPhone,
  type RecontactDryRunRow,
  type RecontactDryRunResult,
  type RecontactDryRunSkipReason,
} from "@/lib/chat/recontact-dry-run-shared";

type RuleRow = {
  id: string;
  empresa_id: string;
  flow_code: string;
  included_node_codes: unknown;
  excluded_node_codes: unknown;
  idle_after_seconds: number;
  max_attempts: number;
  cooldown_seconds: number;
  guard_config: unknown;
};

function parseStringArrayLoose(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    const s = typeof x === "string" ? x.trim() : String(x ?? "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function parseGuard(guard_config: unknown): {
  skip_if_human_taken_over: boolean;
  skip_if_conversation_closed: boolean;
  purchase_condition: PurchaseCondition;
} {
  const base = {
    skip_if_human_taken_over: true,
    skip_if_conversation_closed: true,
    purchase_condition: "none" as PurchaseCondition,
  };
  if (!guard_config || typeof guard_config !== "object" || Array.isArray(guard_config)) return base;
  const o = guard_config as Record<string, unknown>;
  if (typeof o.skip_if_human_taken_over === "boolean") base.skip_if_human_taken_over = o.skip_if_human_taken_over;
  if (typeof o.skip_if_conversation_closed === "boolean") base.skip_if_conversation_closed = o.skip_if_conversation_closed;
  const pc = o.purchase_condition;
  if (pc === "no_confirmed_sorteo_order" || pc === "none") base.purchase_condition = pc;
  return base;
}

async function fetchLastInboundByConversationIds(
  supabase: SupabaseAdmin,
  pool: Pool | null,
  schema: string,
  conversationIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (conversationIds.length === 0) return map;

  const sch = assertAllowedChatDataSchema(schema);

  if (pool) {
    const qt = quoteSchemaTable(sch, "chat_messages");
    const r = await pool.query(
      `SELECT DISTINCT ON (m.conversation_id) m.conversation_id::text AS conversation_id, m.created_at
       FROM ${qt} m
       WHERE m.conversation_id = ANY($1::uuid[])
         AND m.sender_type = 'contact'
       ORDER BY m.conversation_id, m.created_at DESC`,
      [conversationIds]
    );
    for (const row of r.rows ?? []) {
      const id = String((row as { conversation_id?: string }).conversation_id ?? "");
      const ca = (row as { created_at?: Date | string }).created_at;
      if (!id) continue;
      const iso = ca instanceof Date ? ca.toISOString() : String(ca ?? "");
      if (iso) map.set(id, iso);
    }
    return map;
  }

  const chunkSize = 40;
  for (let i = 0; i < conversationIds.length; i += chunkSize) {
    const chunk = conversationIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("chat_messages")
      .select("conversation_id, created_at")
      .in("conversation_id", chunk)
      .eq("sender_type", "contact");
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const cid = String((row as { conversation_id?: string }).conversation_id ?? "");
      const created_at = (row as { created_at?: string }).created_at ?? null;
      if (!cid || !created_at) continue;
      const prev = map.get(cid);
      if (!prev || new Date(created_at).getTime() > new Date(prev).getTime()) {
        map.set(cid, created_at);
      }
    }
  }
  return map;
}

async function fetchConfirmedPurchaseConversationIds(
  supabase: SupabaseAdmin,
  empresaId: string,
  conversationIds: string[]
): Promise<Set<string>> {
  const set = new Set<string>();
  if (conversationIds.length === 0) return set;
  const chunkSize = 80;
  for (let i = 0; i < conversationIds.length; i += chunkSize) {
    const chunk = conversationIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("sorteo_entradas")
      .select("chat_conversation_id")
      .eq("empresa_id", empresaId)
      .eq("estado_pago", "confirmado")
      .in("chat_conversation_id", chunk);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const id = (row as { chat_conversation_id?: string | null }).chat_conversation_id;
      if (id) set.add(String(id));
    }
  }
  return set;
}

type RunRow = { conversation_id: string; decision: string; created_at: string };

function groupRunsByConversation(runs: RunRow[]): Map<string, RunRow[]> {
  const m = new Map<string, RunRow[]>();
  for (const r of runs) {
    const cid = String(r.conversation_id ?? "");
    if (!cid) continue;
    const list = m.get(cid) ?? [];
    list.push(r);
    m.set(cid, list);
  }
  return m;
}

function evaluateAttempts(
  list: RunRow[] | undefined,
  maxAttempts: number,
  cooldownSeconds: number,
  nowMs: number
): { blocked: false } | { blocked: true; reason: "max_attempts_reached" | "cooldown_active" } {
  if (!list?.length) return { blocked: false };
  const sent = list.filter((r) => String(r.decision ?? "").trim().toLowerCase() === "sent");
  if (sent.length >= maxAttempts) return { blocked: true, reason: "max_attempts_reached" };
  const lastSent = sent.reduce((acc, r) => {
    const t = new Date(r.created_at).getTime();
    return t > acc ? t : acc;
  }, 0);
  if (lastSent > 0 && nowMs - lastSent < cooldownSeconds * 1000) {
    return { blocked: true, reason: "cooldown_active" };
  }
  return { blocked: false };
}

export async function runRecontactDryRun(params: {
  supabase: SupabaseAdmin;
  empresaId: string;
  dataSchema: string;
  flowCode: string;
  rule: RuleRow;
}): Promise<RecontactDryRunResult> {
  const { supabase, empresaId, flowCode, rule, dataSchema } = params;
  const pool = getChatPostgresPool();
  const guard = parseGuard(rule.guard_config);
  const included = parseStringArrayLoose(rule.included_node_codes);
  const excluded = parseStringArrayLoose(rule.excluded_node_codes);
  const excludedSet = new Set(excluded);
  const includedSet = new Set(included);

  const { data: convRows, error: convErr } = await supabase
    .from("chat_conversations")
    .select(
      "id, contact_id, status, flow_code, flow_current_node, flow_status, human_taken_over, active_flow_session_id, last_message_at"
    )
    .eq("empresa_id", empresaId)
    .eq("flow_code", flowCode)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(RECONTACT_DRY_RUN_CONVERSATION_LIMIT);

  if (convErr) throw new Error(convErr.message);

  const conversations = (convRows ?? []) as Array<{
    id: string;
    contact_id: string;
    status: string;
    flow_code: string | null;
    flow_current_node: string | null;
    flow_status: string;
    human_taken_over: boolean;
    active_flow_session_id: string | null;
    last_message_at: string | null;
  }>;

  const scanned = conversations.length;
  const limitReached = scanned >= RECONTACT_DRY_RUN_CONVERSATION_LIMIT;

  const convIds = conversations.map((c) => c.id);
  const contactIds = [...new Set(conversations.map((c) => c.contact_id).filter(Boolean))];

  const contactMap = new Map<string, { name: string | null; phone: string | null }>();
  if (contactIds.length > 0) {
    const chunkSize = 100;
    for (let i = 0; i < contactIds.length; i += chunkSize) {
      const chunk = contactIds.slice(i, i + chunkSize);
      const { data: cRows, error: cErr } = await supabase
        .from("chat_contacts")
        .select("id, name, phone_number")
        .eq("empresa_id", empresaId)
        .in("id", chunk);
      if (cErr) throw new Error(cErr.message);
      for (const r of cRows ?? []) {
        const row = r as { id?: string; name?: string | null; phone_number?: string | null };
        if (row.id) {
          contactMap.set(String(row.id), {
            name: row.name ?? null,
            phone: row.phone_number ?? null,
          });
        }
      }
    }
  }

  const [lastInboundMap, purchaseSet] = await Promise.all([
    fetchLastInboundByConversationIds(supabase, pool, dataSchema, convIds),
    convIds.length > 0
      ? fetchConfirmedPurchaseConversationIds(supabase, empresaId, convIds)
      : Promise.resolve(new Set<string>()),
  ]);

  const runsRes =
    convIds.length > 0
      ? await supabase
          .from("chat_flow_recontact_runs")
          .select("conversation_id, decision, created_at")
          .eq("empresa_id", empresaId)
          .eq("rule_id", rule.id)
          .in("conversation_id", convIds)
      : { data: [] as RunRow[], error: null };

  if (runsRes.error) throw new Error(runsRes.error.message);
  const runsList = runsRes.data ?? [];
  const runsByConv = groupRunsByConversation(runsList);

  const nowMs = Date.now();
  const idleAfterMs = rule.idle_after_seconds * 1000;

  const rows: RecontactDryRunRow[] = [];
  let candidates = 0;
  let skipped = 0;

  for (const c of conversations) {
    const cid = c.id;
    const currentNode = c.flow_current_node?.trim() ?? null;
    const contact = contactMap.get(c.contact_id);
    const phone_masked = maskChatPhone(contact?.phone ?? null);
    const contact_name = contact?.name ?? null;

    const hasPurchase = purchaseSet.has(cid);

    let skip_reason: RecontactDryRunSkipReason | null = null;

    if (guard.skip_if_conversation_closed && c.status === "closed") {
      skip_reason = "conversation_closed";
    } else if (guard.skip_if_human_taken_over && c.human_taken_over) {
      skip_reason = "human_takeover";
    } else if (c.flow_status !== "bot") {
      skip_reason = "not_bot_flow_status";
    } else if (!c.active_flow_session_id) {
      skip_reason = "no_active_session";
    } else if (currentNode && excludedSet.has(currentNode)) {
      skip_reason = "node_not_in_rule";
    } else if (includedSet.size > 0 && (!currentNode || !includedSet.has(currentNode))) {
      skip_reason = "node_not_in_rule";
    } else if (!currentNode && includedSet.size > 0) {
      skip_reason = "node_not_in_rule";
    }

    const lastInbound = lastInboundMap.get(cid) ?? null;
    let idle_minutes: number | null = null;

    if (!skip_reason) {
      if (!lastInbound) {
        skip_reason = "missing_last_inbound";
      } else {
        const idleMs = nowMs - new Date(lastInbound).getTime();
        idle_minutes = Math.floor(idleMs / 60_000);
        if (idleMs < idleAfterMs) {
          skip_reason = "not_enough_idle_time";
        }
      }
    }

    if (!skip_reason && guard.purchase_condition === "no_confirmed_sorteo_order" && hasPurchase) {
      skip_reason = "purchase_exists";
    }

    if (!skip_reason) {
      const att = evaluateAttempts(runsByConv.get(cid), rule.max_attempts, rule.cooldown_seconds, nowMs);
      if (att.blocked) {
        skip_reason = att.reason;
      }
    }

    const status: "candidate" | "skipped" = skip_reason ? "skipped" : "candidate";
    if (status === "candidate") candidates += 1;
    else skipped += 1;

    rows.push({
      conversation_id: cid,
      contact_name,
      phone_masked,
      current_node: currentNode,
      last_inbound_at: lastInbound,
      idle_minutes,
      status,
      skip_reason,
      human_taken_over: c.human_taken_over,
      flow_status: c.flow_status,
      has_confirmed_purchase: hasPurchase,
    });
  }

  return {
    scanned,
    limit: RECONTACT_DRY_RUN_CONVERSATION_LIMIT,
    limitReached,
    candidates,
    skipped,
    rows,
  };
}
