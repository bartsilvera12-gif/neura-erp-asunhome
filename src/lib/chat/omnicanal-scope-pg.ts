import type { Pool } from "pg";
import type { OmnicanalScope, SupervisorConversationScopeBundle } from "@/lib/chat/omnicanal-scope";
import { quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";

/** Misma constante que `OMNICANAL_IMPOSSIBLE_CONVERSATION_ID` (evita import circular). */
const IMPOSSIBLE_CONVERSATION_ID = "00000000-0000-0000-0000-000000000001";

function isAdminScope(scope: OmnicanalScope): boolean {
  return scope.role === "admin";
}

function normalizeId(v: string | null | undefined): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function pgSelectChatAgentIdsForUsuarios(
  pool: Pool,
  schema: string,
  empresaId: string,
  usuarioIds: string[],
  preferActive: boolean
): Promise<string[]> {
  const ids = [...new Set(usuarioIds.map((x) => normalizeId(x)).filter(Boolean))];
  if (ids.length === 0) return [];
  const qt = quoteSchemaTable(schema, "chat_agents");
  const tryQuery = async (withActive: boolean): Promise<string[]> => {
    const activeSql = withActive ? "AND COALESCE(is_active, true) = true" : "";
    const q = `
      SELECT id::text AS id FROM ${qt}
      WHERE empresa_id = $1::uuid
        AND usuario_id = ANY($2::uuid[])
        ${activeSql}
    `;
    const r = await pool.query(q, [empresaId, ids]);
    return [...new Set((r.rows ?? []).map((row: { id?: string }) => String(row.id ?? "").trim()).filter(Boolean))];
  };
  try {
    if (preferActive) {
      const a = await tryQuery(true);
      if (a.length > 0) return a;
    }
    return await tryQuery(false);
  } catch {
    return await tryQuery(false);
  }
}

export async function pgSelectQueueIdsForUsuarios(
  pool: Pool,
  schema: string,
  empresaId: string,
  usuarioIds: string[],
  preferActive: boolean
): Promise<string[]> {
  const ids = [...new Set(usuarioIds.map((x) => normalizeId(x)).filter(Boolean))];
  if (ids.length === 0) return [];
  const qt = quoteSchemaTable(schema, "chat_agents");
  const tryQuery = async (withActive: boolean): Promise<string[]> => {
    const activeSql = withActive ? "AND COALESCE(is_active, true) = true" : "";
    const q = `
      SELECT queue_id::text AS qid FROM ${qt}
      WHERE empresa_id = $1::uuid
        AND usuario_id = ANY($2::uuid[])
        AND queue_id IS NOT NULL
        ${activeSql}
    `;
    const r = await pool.query(q, [empresaId, ids]);
    return [
      ...new Set(
        (r.rows ?? []).map((row: { qid?: string }) => String(row.qid ?? "").trim()).filter(Boolean)
      ),
    ];
  };
  try {
    if (preferActive) {
      const a = await tryQuery(true);
      if (a.length > 0) return a;
    }
    return await tryQuery(false);
  } catch {
    return await tryQuery(false);
  }
}

export async function pgResolveChannelIdsForQueueIds(
  pool: Pool,
  schema: string,
  empresaId: string,
  queueIds: string[]
): Promise<string[]> {
  const ids = [...new Set(queueIds.map((x) => normalizeId(x)).filter(Boolean))];
  if (ids.length === 0) return [];
  try {
    const qt = quoteSchemaTable(schema, "chat_queue_channels");
    const q = `
      SELECT channel_id::text AS cid FROM ${qt}
      WHERE empresa_id = $1::uuid AND queue_id = ANY($2::uuid[])
    `;
    const r = await pool.query(q, [empresaId, ids]);
    return [
      ...new Set(
        (r.rows ?? []).map((row: { cid?: string }) => String(row.cid ?? "").trim()).filter(Boolean)
      ),
    ];
  } catch {
    return [];
  }
}

/** Misma semántica que `resolveSupervisorConversationScopeBundle` pero vía SQL directo. */
export async function resolveSupervisorConversationScopeBundlePg(
  pool: Pool,
  schema: string,
  empresaId: string,
  scope: OmnicanalScope
): Promise<SupervisorConversationScopeBundle> {
  if (scope.role !== "supervisor") {
    return { kind: "empty" };
  }
  const agentFkIds = await pgSelectChatAgentIdsForUsuarios(
    pool,
    schema,
    empresaId,
    scope.agentUsuarioIds,
    true
  );
  const teamQueueIds = await pgSelectQueueIdsForUsuarios(
    pool,
    schema,
    empresaId,
    scope.agentUsuarioIds,
    true
  );
  const queueIdsUnion = [...new Set([...teamQueueIds, ...(scope.queueIds ?? [])])];
  const channelIdsFromTeamQueues =
    queueIdsUnion.length > 0
      ? await pgResolveChannelIdsForQueueIds(pool, schema, empresaId, queueIdsUnion)
      : [];

  if (
    agentFkIds.length === 0 &&
    queueIdsUnion.length === 0 &&
    channelIdsFromTeamQueues.length === 0
  ) {
    return { kind: "empty" };
  }
  return {
    kind: "ok",
    agentFkIds,
    queueIdsUnion,
    channelIdsFromTeamQueues,
  };
}

/**
 * Fragmento SQL `AND (...)` para filtrar `chat_conversations` por alcance omnicanal (sin admin).
 * Params empiezan en `$paramOffset` (1-based).
 */
export async function buildPgOmnicanalConversationScopeAndClause(
  pool: Pool,
  schema: string,
  empresaId: string,
  scope: OmnicanalScope,
  paramOffset: number
): Promise<{ sql: string; params: unknown[]; nextOffset: number }> {
  if (isAdminScope(scope)) {
    return { sql: "TRUE", params: [], nextOffset: paramOffset };
  }

  if (scope.role === "supervisor") {
    const bundle = await resolveSupervisorConversationScopeBundlePg(pool, schema, empresaId, scope);
    if (bundle.kind === "empty") {
      const impossible = normalizeId(IMPOSSIBLE_CONVERSATION_ID);
      return {
        sql: `id = $${paramOffset}::uuid`,
        params: [impossible],
        nextOffset: paramOffset + 1,
      };
    }
    const parts: string[] = [];
    const params: unknown[] = [];
    let off = paramOffset;

    if (bundle.agentFkIds.length > 0) {
      parts.push(`assigned_agent_id = ANY($${off}::uuid[])`);
      params.push(bundle.agentFkIds);
      off++;
    }
    if (bundle.queueIdsUnion.length > 0) {
      parts.push(
        `(assigned_agent_id IS NULL AND queue_id IS NOT NULL AND queue_id = ANY($${off}::uuid[]))`
      );
      params.push(bundle.queueIdsUnion);
      off++;
    }
    if (bundle.channelIdsFromTeamQueues.length > 0) {
      parts.push(
        `(assigned_agent_id IS NULL AND channel_id IS NOT NULL AND channel_id = ANY($${off}::uuid[]))`
      );
      params.push(bundle.channelIdsFromTeamQueues);
      off++;
    }

    if (parts.length === 0) {
      const impossible = normalizeId(IMPOSSIBLE_CONVERSATION_ID);
      return {
        sql: `id = $${paramOffset}::uuid`,
        params: [impossible],
        nextOffset: paramOffset + 1,
      };
    }

    return {
      sql: `(${parts.join(" OR ")})`,
      params,
      nextOffset: off,
    };
  }

  const agentFkIds = await pgSelectChatAgentIdsForUsuarios(
    pool,
    schema,
    empresaId,
    scope.agentUsuarioIds,
    true
  );
  const queueIds = scope.queueIds ?? [];

  if (queueIds.length === 0 && agentFkIds.length === 0) {
    const hadIntent =
      (scope.agentUsuarioIds?.length ?? 0) > 0 || (scope.queueIds?.length ?? 0) > 0;
    if (hadIntent) {
      return { sql: "TRUE", params: [], nextOffset: paramOffset };
    }
    const impossible = normalizeId(IMPOSSIBLE_CONVERSATION_ID);
    return {
      sql: `id = $${paramOffset}::uuid`,
      params: [impossible],
      nextOffset: paramOffset + 1,
    };
  }

  const parts: string[] = [];
  const params: unknown[] = [];
  let off = paramOffset;

  if (queueIds.length > 0 && agentFkIds.length > 0) {
    parts.push(`queue_id = ANY($${off}::uuid[])`);
    params.push(queueIds);
    off++;
    parts.push(`assigned_agent_id = ANY($${off}::uuid[])`);
    params.push(agentFkIds);
    off++;
    return {
      sql: `(${parts.join(" OR ")})`,
      params,
      nextOffset: off,
    };
  }
  if (queueIds.length > 0) {
    return {
      sql: `queue_id = ANY($${paramOffset}::uuid[])`,
      params: [queueIds],
      nextOffset: paramOffset + 1,
    };
  }
  if (agentFkIds.length === 0) {
    const impossible = normalizeId(IMPOSSIBLE_CONVERSATION_ID);
    return {
      sql: `id = $${paramOffset}::uuid`,
      params: [impossible],
      nextOffset: paramOffset + 1,
    };
  }
  return {
    sql: `assigned_agent_id = ANY($${paramOffset}::uuid[])`,
    params: [agentFkIds],
    nextOffset: paramOffset + 1,
  };
}
