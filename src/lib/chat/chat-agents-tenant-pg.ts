import type { Pool } from "pg";
import { isAgentSessionOnline } from "@/lib/chat/agent-presence";
import type { EmpresaTenantSrContext } from "@/lib/chat/empresa-tenant-service-role";
import type { OmnicanalScope } from "@/lib/chat/omnicanal-scope";
import { buildPgOmnicanalConversationScopeAndClause } from "@/lib/chat/omnicanal-scope-pg";
import { isMissingColumnError } from "@/lib/chat/postgres-column-error";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";

export type ChatAgentDirectoryRowPg = {
  id: string;
  queue_id: string;
  queue_nombre: string;
  usuario_id: string;
  nombre: string;
  email: string;
  is_online: boolean;
  operational_status: string;
  max_conversations: number;
  operational_status_changed_at?: string | null;
  last_heartbeat_at?: string | null;
};

export type MyAgentOperationalPresencePgResult =
  | { in_queues: false }
  | { in_queues: true; status: "ready" | "offline"; status_changed_at: string | null };

function isoPg(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function earliest(xs: string[]): string | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => (a < b ? a : b));
}

export async function pgGetMyAgentOperationalPresence(
  pool: Pool,
  schema: string,
  empresaId: string,
  usuarioId: string
): Promise<MyAgentOperationalPresencePgResult> {
  const qt = quoteSchemaTable(schema, "chat_agents");

  const fetchRows = async (cols: string): Promise<Record<string, unknown>[] | null> => {
    try {
      const q = `
        SELECT ${cols}
        FROM ${qt}
        WHERE empresa_id = $1::uuid AND usuario_id = $2::uuid
      `;
      const r = await pool.query(q, [empresaId, usuarioId]);
      return (r.rows ?? []) as Record<string, unknown>[];
    } catch {
      return null;
    }
  };

  const summarize = (
    rows: Record<string, unknown>[]
  ): MyAgentOperationalPresencePgResult => {
    const anyOffline = rows.some((row) => String(row.operational_status ?? "").trim() === "offline");
    const status = anyOffline ? "offline" : "ready";
    const changedAts = rows
      .map((row) => isoPg(row.operational_status_changed_at))
      .filter((x): x is string => typeof x === "string" && x.length > 0);
    const updatedAts = rows
      .map((row) => isoPg(row.updated_at))
      .filter((x): x is string => typeof x === "string" && x.length > 0);
    const status_changed_at =
      changedAts.length > 0 ? earliest(changedAts)! : updatedAts.length > 0 ? earliest(updatedAts)! : null;
    return { in_queues: true, status, status_changed_at };
  };

  let rows =
    (await fetchRows(
      `operational_status::text, operational_status_changed_at, updated_at, last_heartbeat_at`
    )) ?? [];
  if (rows.length === 0) {
    rows =
      (await fetchRows(`operational_status::text, operational_status_changed_at, updated_at`)) ?? [];
  }
  if (rows.length === 0) {
    rows = (await fetchRows(`operational_status::text, updated_at`)) ?? [];
  }

  if (rows.length > 0) {
    return summarize(rows);
  }

  try {
    const q = `SELECT id::text FROM ${qt} WHERE empresa_id = $1::uuid AND usuario_id = $2::uuid`;
    const leg = await pool.query(q, [empresaId, usuarioId]);
    if ((leg.rows ?? []).length === 0) return { in_queues: false };
    return { in_queues: true, status: "ready", status_changed_at: null };
  } catch {
    return { in_queues: false };
  }
}

export async function pgSetMyAgentOperationalPresence(
  pool: Pool,
  schema: string,
  empresaId: string,
  usuarioId: string,
  status: "ready" | "offline",
  ts: string
): Promise<{ applied: boolean; reason?: string }> {
  const qt = quoteSchemaTable(schema, "chat_agents");

  const attempts: string[] = [
    `operational_status = $3::text, updated_at = $4::timestamptz,
     operational_status_changed_at = $4::timestamptz, last_heartbeat_at = $4::timestamptz`,
    `operational_status = $3::text, updated_at = $4::timestamptz,
     operational_status_changed_at = $4::timestamptz`,
    `operational_status = $3::text, updated_at = $4::timestamptz`,
  ];

  for (const sets of attempts) {
    try {
      await pool.query(
        `UPDATE ${qt} SET ${sets} WHERE empresa_id = $1::uuid AND usuario_id = $2::uuid`,
        [empresaId, usuarioId, status, ts]
      );
      return { applied: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (isMissingColumnError(msg, "last_heartbeat_at")) continue;
      if (isMissingColumnError(msg, "operational_status_changed_at")) continue;
      if (isMissingColumnError(msg, "operational_status")) {
        return { applied: false, reason: "missing_operational_status_column" };
      }
    }
  }

  return { applied: false, reason: "update_failed" };
}

export async function pgTouchChatAgentInboxHeartbeat(
  pool: Pool,
  schema: string,
  empresaId: string,
  usuarioId: string,
  ts: string
): Promise<{ ok: boolean; reason?: string }> {
  const qt = quoteSchemaTable(schema, "chat_agents");
  try {
    await pool.query(
      `UPDATE ${qt}
       SET last_heartbeat_at = $3::timestamptz, updated_at = $3::timestamptz
       WHERE empresa_id = $1::uuid AND usuario_id = $2::uuid`,
      [empresaId, usuarioId, ts]
    );
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (isMissingColumnError(msg, "last_heartbeat_at")) {
      try {
        await pool.query(
          `UPDATE ${qt} SET updated_at = $3::timestamptz
           WHERE empresa_id = $1::uuid AND usuario_id = $2::uuid`,
          [empresaId, usuarioId, ts]
        );
        return { ok: true };
      } catch {
        return { ok: false, reason: msg };
      }
    }
    return { ok: false, reason: msg };
  }
}

async function pgSelectAgentsRaw(
  pool: Pool,
  schema: string,
  empresaId: string,
  scope: OmnicanalScope,
  bypass: boolean
): Promise<Record<string, unknown>[]> {
  const qt = quoteSchemaTable(schema, "chat_agents");
  if (!bypass && scope.agentUsuarioIds.length === 0) return [];

  const usuarioClause =
    !bypass && scope.agentUsuarioIds.length > 0
      ? `AND usuario_id = ANY($2::uuid[])`
      : "";
  const params: unknown[] =
    !bypass && scope.agentUsuarioIds.length > 0 ? [empresaId, scope.agentUsuarioIds] : [empresaId];

  const tryCols = async (selectSql: string): Promise<Record<string, unknown>[] | null> => {
    try {
      const q = `
        SELECT ${selectSql}
        FROM ${qt}
        WHERE empresa_id = $1::uuid AND COALESCE(is_active, true) = true
        ${usuarioClause}
        ORDER BY queue_id ASC NULLS LAST
      `;
      const r = await pool.query(q, params);
      return (r.rows ?? []) as Record<string, unknown>[];
    } catch {
      return null;
    }
  };

  const rows =
    (await tryCols(`
      id::text, queue_id::text, is_online, operational_status::text,
      operational_status_changed_at, last_heartbeat_at, max_conversations,
      usuario_id::text
    `)) ??
    (await tryCols(`
      id::text, queue_id::text, is_online, operational_status::text,
      max_conversations, usuario_id::text
    `)) ??
    (await tryCols(`id::text, queue_id::text, is_online, max_conversations, usuario_id::text`));

  return rows ?? [];
}

export async function pgListChatAgentsDirectoryWithContext(
  pool: Pool,
  schema: string,
  ctx: EmpresaTenantSrContext,
  scope: OmnicanalScope,
  bypass: boolean
): Promise<ChatAgentDirectoryRowPg[]> {
  const { catalogSr, empresa_id } = ctx;
  const rows = await pgSelectAgentsRaw(pool, schema, empresa_id, scope, bypass);
  const queueIds = [...new Set(rows.map((row) => String(row.queue_id ?? "").trim()).filter(Boolean))];

  let queueNombreById: Record<string, string> = {};
  if (queueIds.length > 0) {
    const qt = quoteSchemaTable(schema, "chat_queues");
    try {
      const qr = await pool.query(
        `SELECT id::text, nombre FROM ${qt} WHERE empresa_id = $1::uuid AND id = ANY($2::uuid[])`,
        [empresa_id, queueIds]
      );
      queueNombreById = Object.fromEntries(
        (qr.rows ?? []).map((r: { id?: string; nombre?: string | null }) => [
          String(r.id ?? ""),
          String(r.nombre ?? "").trim() || "Cola",
        ])
      );
    } catch {
      queueNombreById = {};
    }
  }

  const uids = [...new Set(rows.map((row) => String(row.usuario_id ?? "").trim()).filter(Boolean))];
  let usuarioById: Record<string, { nombre: string | null; email: string | null }> = {};
  if (uids.length > 0) {
    const { data: urows, error: uErr } = await catalogSr
      .from("usuarios")
      .select("id, nombre, email")
      .in("id", uids);
    if (!uErr && urows) {
      usuarioById = Object.fromEntries(
        urows.map((u) => [
          u.id as string,
          {
            nombre: (u as { nombre?: string | null }).nombre ?? null,
            email: (u as { email?: string | null }).email ?? null,
          },
        ])
      );
    }
  }

  return rows.map((row) => {
    const qid = String(row.queue_id ?? "");
    const queueNombre = queueNombreById[qid] ?? "Cola";
    const uid = String(row.usuario_id ?? "");
    const u = usuarioById[uid];
    const nombre = (u?.nombre?.trim() || u?.email?.trim() || "—") as string;
    const hasHeartbeatField = Object.prototype.hasOwnProperty.call(row, "last_heartbeat_at");
    const sessionOnline = hasHeartbeatField
      ? isAgentSessionOnline((row.last_heartbeat_at as string | null) ?? null)
      : Boolean(row.is_online);
    return {
      id: String(row.id ?? ""),
      queue_id: qid,
      queue_nombre: queueNombre,
      usuario_id: uid,
      nombre,
      email: (u?.email as string) ?? "",
      is_online: sessionOnline,
      operational_status:
        String(row.operational_status ?? "").trim() === "offline" ? "offline" : "ready",
      max_conversations: Number(row.max_conversations) || 5,
      operational_status_changed_at: isoPg(row.operational_status_changed_at),
      last_heartbeat_at: isoPg(row.last_heartbeat_at),
    };
  });
}

export async function pgCountUnassignedOpenWithScope(
  pool: Pool,
  schema: string,
  empresaId: string,
  scope: OmnicanalScope,
  bypass: boolean
): Promise<number> {
  const scopeClause = bypass
    ? { sql: "TRUE", params: [] as unknown[], nextOffset: 2 }
    : await buildPgOmnicanalConversationScopeAndClause(pool, schema, empresaId, scope, 2);

  const qt = quoteSchemaTable(schema, "chat_conversations");
  const params: unknown[] = [empresaId, ...scopeClause.params];
  try {
    const q = `
      SELECT COUNT(*)::bigint AS c
      FROM ${qt}
      WHERE empresa_id = $1::uuid
        AND assigned_agent_id IS NULL
        AND status IN ('open', 'pending')
        AND (${scopeClause.sql})
    `;
    const r = await pool.query(q, params);
    const raw = r.rows?.[0]?.c;
    const n = typeof raw === "bigint" ? Number(raw) : Number(raw ?? 0);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export async function pgLoadSupervisorAgentConversationStats(
  pool: Pool,
  schema: string,
  empresaId: string,
  scope: OmnicanalScope,
  bypass: boolean,
  agentIds: string[]
): Promise<
  Array<{ assigned_agent_id: string | null; first_human_response_at: string | null; status: string | null }>
> {
  const ids = [...new Set(agentIds.map((x) => String(x ?? "").trim()).filter(Boolean))];
  if (ids.length === 0) return [];

  const scopeClause = bypass
    ? { sql: "TRUE", params: [] as unknown[], nextOffset: 3 }
    : await buildPgOmnicanalConversationScopeAndClause(pool, schema, empresaId, scope, 3);

  const qt = quoteSchemaTable(schema, "chat_conversations");
  const params: unknown[] = [empresaId, ids, ...scopeClause.params];
  const q = `
    SELECT assigned_agent_id::text, first_human_response_at, status::text
    FROM ${qt}
    WHERE empresa_id = $1::uuid
      AND assigned_agent_id = ANY($2::uuid[])
      AND status <> 'closed'
      AND (${scopeClause.sql})
  `;
  const r = await pool.query(q, params);
  return (r.rows ?? []).map((row: Record<string, unknown>) => ({
    assigned_agent_id: row.assigned_agent_id != null ? String(row.assigned_agent_id) : null,
    first_human_response_at: isoPg(row.first_human_response_at),
    status: row.status != null ? String(row.status) : null,
  }));
}
