"use server";

import {
  ALL_FALLBACK_CLOSURE_TAXONOMY,
  DEFAULT_CLOSURE_TAXONOMY,
  EMERGENCY_MODAL_CLOSURE_TAXONOMY,
  isFallbackClosureStateId,
} from "@/lib/chat/chat-closure-fallback";
import { requireEmpresaTenantServiceRole } from "@/lib/chat/empresa-tenant-service-role";
import type { Pool } from "pg";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { isLikelyUnexposedTenantChatSchema } from "@/lib/supabase/chat-data-schema";

export type FinalizeOptionState = {
  id: string;
  label: string;
  substates: { id: string; label: string }[];
};

export type FinalizeOptionsResult = {
  source: "queue" | "fallback";
  states: FinalizeOptionState[];
};

function fallbackOptions(): FinalizeOptionsResult {
  return {
    source: "fallback",
    states: DEFAULT_CLOSURE_TAXONOMY.map((s) => ({
      id: s.id,
      label: s.label,
      substates: s.substates.map((x) => ({ id: x.id, label: x.label })),
    })),
  };
}

/** Opciones mínimas si falla la lectura de estados en BD: el modal nunca queda sin datos. */
function emergencyModalFallbackOptions(): FinalizeOptionsResult {
  return {
    source: "fallback",
    states: EMERGENCY_MODAL_CLOSURE_TAXONOMY.map((s) => ({
      id: s.id,
      label: s.label,
      substates: s.substates.map((x) => ({ id: x.id, label: x.label })),
    })),
  };
}

async function loadFinalizeOptionsFromPg(
  pool: Pool,
  schema: string,
  empresaId: string,
  conversationId: string
): Promise<FinalizeOptionsResult> {
  const convT = quoteSchemaTable(schema, "chat_conversations");
  try {
    const cr = await pool.query(
      `SELECT queue_id::text, status::text FROM ${convT}
       WHERE id = $1::uuid AND empresa_id = $2::uuid LIMIT 1`,
      [conversationId, empresaId]
    );
    const row = cr.rows?.[0] as { queue_id?: string | null; status?: string | null } | undefined;
    if (!row) return emergencyModalFallbackOptions();
    if (String(row.status ?? "").toLowerCase() === "closed") {
      throw new Error("La conversación ya está finalizada");
    }
    const qid = row.queue_id?.trim() || null;
    if (!qid) {
      return fallbackOptions();
    }

    const stT = quoteSchemaTable(schema, "chat_queue_closure_states");
    const sr = await pool.query(
      `SELECT id::text, label::text FROM ${stT}
       WHERE empresa_id = $1::uuid AND queue_id = $2::uuid AND COALESCE(is_active, true) = true
       ORDER BY sort_order ASC NULLS LAST`,
      [empresaId, qid]
    );
    const st = (sr.rows ?? []) as { id: string; label: string }[];
    if (st.length === 0) {
      return fallbackOptions();
    }

    const ids = st.map((x) => x.id);
    const subT = quoteSchemaTable(schema, "chat_queue_closure_substates");
    const subr = await pool.query(
      `SELECT id::text, closure_state_id::text, label::text FROM ${subT}
       WHERE empresa_id = $1::uuid AND closure_state_id = ANY($2::uuid[]) AND COALESCE(is_active, true) = true
       ORDER BY sort_order ASC NULLS LAST`,
      [empresaId, ids]
    );
    const byState = new Map<string, { id: string; label: string }[]>();
    for (const raw of subr.rows ?? []) {
      const x = raw as { id?: string; closure_state_id?: string; label?: string };
      const sid = String(x.closure_state_id ?? "").trim();
      if (!sid) continue;
      const arr = byState.get(sid) ?? [];
      arr.push({ id: String(x.id ?? ""), label: String(x.label ?? "") });
      byState.set(sid, arr);
    }

    return {
      source: "queue",
      states: st.map((s) => ({
        id: s.id,
        label: s.label,
        substates: byState.get(s.id) ?? [],
      })),
    };
  } catch (e) {
    if (e instanceof Error && e.message.includes("finalizada")) throw e;
    console.error("[loadFinalizeOptionsFromPg]", e);
    return emergencyModalFallbackOptions();
  }
}

export async function loadFinalizeOptionsForConversation(conversationId: string): Promise<FinalizeOptionsResult> {
  const ctx = await requireEmpresaTenantServiceRole();
  const id = conversationId.trim();
  if (!id) return emergencyModalFallbackOptions();

  const pool = getChatPostgresPool();
  if (pool && isLikelyUnexposedTenantChatSchema(ctx.dataSchema)) {
    return loadFinalizeOptionsFromPg(pool, ctx.dataSchema, ctx.empresa_id, id);
  }

  const { supabase, empresa_id } = ctx;
  const { data: conv, error: cErr } = await supabase
    .from("chat_conversations")
    .select("id, queue_id, status")
    .eq("id", id)
    .eq("empresa_id", empresa_id)
    .maybeSingle();
  if (cErr) {
    console.error("[loadFinalizeOptionsForConversation] conv:", cErr.message);
    return emergencyModalFallbackOptions();
  }
  if (!conv) return emergencyModalFallbackOptions();
  if (String((conv as { status?: string }).status).toLowerCase() === "closed") {
    throw new Error("La conversación ya está finalizada");
  }

  const qid = (conv as { queue_id?: string | null }).queue_id?.trim() || null;
  if (!qid) {
    return fallbackOptions();
  }

  try {
    const { data: states, error: sErr } = await supabase
      .from("chat_queue_closure_states")
      .select("id, label, sort_order, is_active")
      .eq("empresa_id", empresa_id)
      .eq("queue_id", qid)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (sErr) {
      console.error("[loadFinalizeOptionsForConversation] chat_queue_closure_states:", sErr.message);
      return emergencyModalFallbackOptions();
    }
    const st = (states ?? []) as { id: string; label: string }[];
    if (st.length === 0) {
      return fallbackOptions();
    }

    const ids = st.map((x) => x.id);
    const { data: subs, error: subErr } = await supabase
      .from("chat_queue_closure_substates")
      .select("id, closure_state_id, label, sort_order, is_active")
      .eq("empresa_id", empresa_id)
      .in("closure_state_id", ids)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (subErr) {
      console.error("[loadFinalizeOptionsForConversation] chat_queue_closure_substates:", subErr.message);
      return emergencyModalFallbackOptions();
    }
    const byState = new Map<string, { id: string; label: string }[]>();
    for (const row of subs ?? []) {
      const sid = (row as { closure_state_id: string }).closure_state_id;
      const arr = byState.get(sid) ?? [];
      arr.push({ id: (row as { id: string }).id, label: String((row as { label?: string }).label ?? "") });
      byState.set(sid, arr);
    }

    return {
      source: "queue",
      states: st.map((s) => ({
        id: s.id,
        label: s.label,
        substates: byState.get(s.id) ?? [],
      })),
    };
  } catch (e) {
    console.error("[loadFinalizeOptionsForConversation]", e);
    return emergencyModalFallbackOptions();
  }
}

function resolveFallbackLabels(stateId: string, substateId: string | null): { state: string; sub: string } | null {
  for (const s of ALL_FALLBACK_CLOSURE_TAXONOMY) {
    if (s.id !== stateId) continue;
    if (!substateId) {
      if (s.substates.length > 0) return null;
      return { state: s.label, sub: "—" };
    }
    const sub = s.substates.find((x) => x.id === substateId);
    if (!sub) return null;
    return { state: s.label, sub: sub.label };
  }
  return null;
}

export async function finalizeConversationWithClosure(input: {
  conversationId: string;
  closureStateId: string | null;
  closureSubstateId: string | null;
  closureStateLabel: string;
  closureSubstateLabel: string;
  comment: string;
}): Promise<void> {
  const { supabase, empresa_id, usuario_id } = await requireEmpresaTenantServiceRole();
  const convId = input.conversationId.trim();
  if (!convId) throw new Error("Conversación inválida");

  const comment = input.comment.trim();
  if (comment.length < 3) {
    throw new Error("El comentario es obligatorio (al menos 3 caracteres).");
  }

  let stateLabel = input.closureStateLabel.trim();
  let substateLabel = input.closureSubstateLabel.trim();

  const { data: conv, error: cErr } = await supabase
    .from("chat_conversations")
    .select("id, queue_id, status, channel_id, contact_id")
    .eq("id", convId)
    .eq("empresa_id", empresa_id)
    .maybeSingle();
  if (cErr) throw new Error(cErr.message);
  if (!conv) throw new Error("Conversación no encontrada");
  if (String((conv as { status?: string }).status).toLowerCase() === "closed") {
    throw new Error("La conversación ya está finalizada");
  }

  const queueId = ((conv as { queue_id?: string | null }).queue_id ?? null) as string | null;
  let closureStateId: string | null = input.closureStateId?.trim() || null;
  let closureSubstateId: string | null = input.closureSubstateId?.trim() || null;

  if (closureStateId && isFallbackClosureStateId(closureStateId)) {
    const fb = resolveFallbackLabels(closureStateId, closureSubstateId);
    if (!fb) {
      throw new Error("Estado o subestado inválido.");
    }
    stateLabel = fb.state;
    substateLabel = fb.sub || substateLabel || "—";
    closureStateId = null;
    closureSubstateId = null;
  } else if (closureStateId) {
    const { data: st, error: stErr } = await supabase
      .from("chat_queue_closure_states")
      .select("id, label, queue_id")
      .eq("id", closureStateId)
      .eq("empresa_id", empresa_id)
      .maybeSingle();
    if (stErr) throw new Error(stErr.message);
    if (!st) throw new Error("Estado de cierre no encontrado");
    if (queueId && (st as { queue_id: string }).queue_id !== queueId) {
      throw new Error("El estado no pertenece a la cola de esta conversación.");
    }
    stateLabel = String((st as { label: string }).label).trim() || stateLabel;

    const { data: subs, error: subQ } = await supabase
      .from("chat_queue_closure_substates")
      .select("id")
      .eq("closure_state_id", closureStateId)
      .eq("empresa_id", empresa_id)
      .eq("is_active", true);
    if (subQ) throw new Error(subQ.message);
    const subCount = (subs ?? []).length;
    if (subCount > 0) {
      if (!closureSubstateId) {
        throw new Error("Elegí un subestado de cierre.");
      }
      const { data: subRow, error: subErr } = await supabase
        .from("chat_queue_closure_substates")
        .select("id, label")
        .eq("id", closureSubstateId)
        .eq("empresa_id", empresa_id)
        .eq("closure_state_id", closureStateId)
        .maybeSingle();
      if (subErr) throw new Error(subErr.message);
      if (!subRow) throw new Error("Subestado no encontrado.");
      substateLabel = String((subRow as { label: string }).label).trim() || substateLabel;
    } else {
      closureSubstateId = null;
      if (!substateLabel) substateLabel = "—";
    }
  }

  if (!stateLabel.trim()) {
    throw new Error("Elegí un estado de cierre.");
  }
  if (!substateLabel) substateLabel = "—";

  const now = new Date().toISOString();

  const { error: insErr } = await supabase.from("chat_conversation_closures").insert({
    empresa_id: empresa_id,
    conversation_id: convId,
    queue_id: queueId,
    closure_state_id: closureStateId,
    closure_substate_id: closureSubstateId,
    closure_state_label: stateLabel,
    closure_substate_label: substateLabel,
    comment,
    closed_at: now,
    closed_by_usuario_id: usuario_id,
  });
  if (insErr) throw new Error(insErr.message);

  const { error: upErr } = await supabase
    .from("chat_conversations")
    .update({
      status: "closed",
      closed_at: now,
      closed_by_usuario_id: usuario_id,
      updated_at: now,
    })
    .eq("id", convId)
    .eq("empresa_id", empresa_id);
  if (upErr) throw new Error(upErr.message);
}
