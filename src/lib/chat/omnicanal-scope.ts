import type { Pool } from "pg";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { isMissingColumnError } from "@/lib/chat/postgres-column-error";
import {
  fetchAgentsForSupervisorUsuarioIds,
  fetchOmnicanalOperatorRole,
  fetchQueueIdsForSupervisorUsuario,
  type OmnicanalOperatorRole,
} from "@/lib/chat/omnicanal-supervision-read";
import { pgUsuarioTieneChatAgentsRow } from "@/lib/chat/omnicanal-supervision-pg";
import {
  buildPgOmnicanalConversationScopeAndClause,
  pgResolveChannelIdsForQueueIds,
  pgSelectChatAgentIdsForUsuarios,
  pgSelectQueueIdsForUsuarios,
} from "@/lib/chat/omnicanal-scope-pg";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { isLikelyUnexposedTenantChatSchema } from "@/lib/supabase/chat-data-schema";
import { isInvalidPostgrestSchemaError } from "@/lib/chat/postgrest-schema-error";

export type OmnicanalScope = {
  /** Rol en `chat_empresa_operator_roles`; null si no hay fila (ver `agentUsuarioIds` para fallback operador). */
  role: OmnicanalOperatorRole | null;
  /**
   * Colas en `chat_queue_supervisors` (se unen al alcance de colas de agentes a cargo en supervisión).
   */
  queueIds: string[];
  /**
   * Agentes cuyas conversaciones entran en el alcance operativo.
   * - admin: [] = sin restricción por esta dimensión
   * - supervisor: agentes a cargo
   * - agente: `[usuarioId]`
   * - sin rol pero con `chat_agents`: `[usuarioId]` como vista mínima
   */
  agentUsuarioIds: string[];
};

function normalizeId(v: string | null | undefined): string {
  return typeof v === "string" ? v.trim() : "";
}

async function usuarioTieneFilaChatAgents(
  supabase: AppSupabaseClient,
  empresaId: string,
  usuarioId: string,
  tenantDataSchema?: string
): Promise<boolean> {
  const pool = getChatPostgresPool();
  if (pool && tenantDataSchema && isLikelyUnexposedTenantChatSchema(tenantDataSchema)) {
    return pgUsuarioTieneChatAgentsRow(pool, tenantDataSchema, empresaId, usuarioId);
  }

  const { count, error } = await supabase
    .from("chat_agents")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", empresaId)
    .eq("usuario_id", usuarioId)
    .limit(1);

  if (error) {
    const m = (error.message ?? "").toLowerCase();
    const c = String((error as { code?: string }).code ?? "");
    const missingChatAgents =
      m.includes("chat_agents") &&
      (c.toLowerCase() === "pgrst205" ||
        m.includes("does not exist") ||
        m.includes("schema cache") ||
        m.includes("could not find") ||
        m.includes("not found"));
    if (missingChatAgents || isInvalidPostgrestSchemaError(error.message)) return false;
    console.warn("[usuarioTieneFilaChatAgents] error no fatal, se asume sin filas:", error.message);
    return false;
  }
  return (count ?? 0) > 0;
}

/**
 * Alcance omnicanal unificado para un usuario en una empresa.
 *
 * - **admin**: `queueIds` y `agentUsuarioIds` vacíos → sin filtro por estas listas (acceso total a nivel módulo cuando se aplique).
 * - **supervisor**: conversaciones asignadas a agentes del equipo **más** conversaciones sin asignar cuya cola
 *   esté en el alcance (colas de los agentes a cargo y, si aplica, colas de `chat_queue_supervisors`).
 * - **agente**: `agentUsuarioIds = [usuarioId]`, `queueIds` vacío.
 * - **sin rol** pero con fila en `chat_agents`: `role` null, `agentUsuarioIds = [usuarioId]` (vista mínima tipo operador).
 * - **sin rol** y sin `chat_agents`: todo vacío y `role` null.
 *
 * El filtrado en consultas lo aplican los módulos (inbox, monitoreo, historial, etc.).
 */
export async function getOmnicanalScope(
  supabase: AppSupabaseClient,
  empresaId: string | null | undefined,
  usuarioId: string | null | undefined,
  opts?: { tenantDataSchema?: string }
): Promise<OmnicanalScope> {
  const emp = normalizeId(empresaId ?? undefined);
  const uid = normalizeId(usuarioId ?? undefined);
  if (!emp || !uid) {
    return { role: null, queueIds: [], agentUsuarioIds: [] };
  }

  const tenantDataSchema =
    opts?.tenantDataSchema ?? (await fetchDataSchemaForEmpresaId(emp));

  try {
    const role = await fetchOmnicanalOperatorRole(supabase, emp, uid, tenantDataSchema);

    if (role === "admin") {
      return { role: "admin", queueIds: [], agentUsuarioIds: [] };
    }

    if (role === "supervisor") {
      const [queueIds, agentUsuarioIds] = await Promise.all([
        fetchQueueIdsForSupervisorUsuario(supabase, emp, uid, tenantDataSchema),
        fetchAgentsForSupervisorUsuarioIds(supabase, emp, uid, tenantDataSchema),
      ]);
      return {
        role: "supervisor",
        queueIds,
        agentUsuarioIds,
      };
    }

    if (role === "agente") {
      return { role: "agente", queueIds: [], agentUsuarioIds: [uid] };
    }

    if (await usuarioTieneFilaChatAgents(supabase, emp, uid, tenantDataSchema)) {
      return { role: null, queueIds: [], agentUsuarioIds: [uid] };
    }

    return { role: null, queueIds: [], agentUsuarioIds: [] };
  } catch (e) {
    console.error("[getOmnicanalScope] error; alcance mínimo tipo agente para no bloquear inbox:", e);
    return { role: null, queueIds: [], agentUsuarioIds: [uid] };
  }
}

/** Rol operativo admin omnicanal = sin restricción por listas de colas/agentes. */
export function isOmnicanalAdminScope(scope: OmnicanalScope): boolean {
  return scope.role === "admin";
}

/**
 * Admin ERP (`admin`, `administrador`, `super_admin`) sin rol operativo omnicanal:
 * no se restringe por colas/agentes (compatibilidad con quien gestiona pero no está en `chat_empresa_operator_roles`).
 */
const BYPASS_ROLES = new Set([
  "admin",
  "administrador",
  "super_admin",
  "owner",
  "gerente",
  "socio",
  "superusuario",
]);

export async function shouldBypassOmnicanalConversationScope(
  catalogSr: AppSupabaseClient,
  usuarioId: string,
  scope: OmnicanalScope
): Promise<boolean> {
  if (isOmnicanalAdminScope(scope)) return true;
  const uid = normalizeId(usuarioId);
  if (!uid) return false;
  const { data, error } = await catalogSr.from("usuarios").select("rol").eq("id", uid).maybeSingle();
  if (error) {
    console.warn("[shouldBypassOmnicanalConversationScope] no se pudo leer rol; sin filtrar inbox:", error.message);
    return true;
  }
  if (!data) return false;
  const r = String((data as { rol?: string | null }).rol ?? "")
    .trim()
    .toLowerCase();
  return BYPASS_ROLES.has(r);
}

/** Resuelve `chat_agents.id` para los `usuario_id` indicados (misma empresa). */
export async function resolveChatAgentIdsForUsuarios(
  supabase: AppSupabaseClient,
  empresaId: string,
  usuarioIds: string[],
  tenantDataSchema?: string
): Promise<string[]> {
  const ids = [...new Set(usuarioIds.map((x) => normalizeId(x)).filter(Boolean))];
  if (ids.length === 0) return [];

  const pool = getChatPostgresPool();
  if (pool && tenantDataSchema && isLikelyUnexposedTenantChatSchema(tenantDataSchema)) {
    let out = await pgSelectChatAgentIdsForUsuarios(pool, tenantDataSchema, empresaId, ids, true);
    if (out.length === 0) out = await pgSelectChatAgentIdsForUsuarios(pool, tenantDataSchema, empresaId, ids, false);
    return out;
  }

  let { data, error } = await supabase
    .from("chat_agents")
    .select("id")
    .eq("empresa_id", empresaId)
    .in("usuario_id", ids)
    .eq("is_active", true);
  if (error && isMissingColumnError(error.message, "is_active")) {
    ({ data, error } = await supabase
      .from("chat_agents")
      .select("id")
      .eq("empresa_id", empresaId)
      .in("usuario_id", ids));
  }
  if (error) {
    if (isInvalidPostgrestSchemaError(error.message)) return [];
    console.warn("[resolveChatAgentIdsForUsuarios] error no fatal:", error.message);
    return [];
  }
  return [...new Set((data ?? []).map((r) => String((r as { id?: string }).id ?? "").trim()).filter(Boolean))];
}

/** Colas (`chat_queues.id`) en las que participan los usuarios agentes dados. */
export async function resolveQueueIdsForUsuarios(
  supabase: AppSupabaseClient,
  empresaId: string,
  usuarioIds: string[],
  tenantDataSchema?: string
): Promise<string[]> {
  const ids = [...new Set(usuarioIds.map((x) => normalizeId(x)).filter(Boolean))];
  if (ids.length === 0) return [];

  const pool = getChatPostgresPool();
  if (pool && tenantDataSchema && isLikelyUnexposedTenantChatSchema(tenantDataSchema)) {
    let out = await pgSelectQueueIdsForUsuarios(pool, tenantDataSchema, empresaId, ids, true);
    if (out.length === 0) out = await pgSelectQueueIdsForUsuarios(pool, tenantDataSchema, empresaId, ids, false);
    return out;
  }

  let { data, error } = await supabase
    .from("chat_agents")
    .select("queue_id")
    .eq("empresa_id", empresaId)
    .in("usuario_id", ids)
    .eq("is_active", true);
  if (error && isMissingColumnError(error.message, "is_active")) {
    ({ data, error } = await supabase
      .from("chat_agents")
      .select("queue_id")
      .eq("empresa_id", empresaId)
      .in("usuario_id", ids));
  }
  if (error) {
    if (isInvalidPostgrestSchemaError(error.message)) return [];
    console.warn("[resolveQueueIdsForUsuarios] error no fatal:", error.message);
    return [];
  }
  return [...new Set((data ?? []).map((r) => String((r as { queue_id?: string }).queue_id ?? "").trim()).filter(Boolean))];
}

/** Cache opcional por petición para evitar repetir lecturas del alcance supervisor (Monitoreo). */
export type OmnicanalConversationScopeCache = {
  supervisorBundlePromise?: Promise<SupervisorConversationScopeBundle>;
};

export type SupervisorConversationScopeBundle =
  | { kind: "empty" }
  | {
      kind: "ok";
      agentFkIds: string[];
      queueIdsUnion: string[];
      channelIdsFromTeamQueues: string[];
    };

/** Canales vinculados a las colas indicadas (`chat_queue_channels`). */
export async function resolveChannelIdsForQueueIds(
  supabase: AppSupabaseClient,
  empresaId: string,
  queueIds: string[],
  tenantDataSchema?: string
): Promise<string[]> {
  const ids = [...new Set(queueIds.map((x) => normalizeId(x)).filter(Boolean))];
  if (ids.length === 0) return [];

  const pool = getChatPostgresPool();
  if (pool && tenantDataSchema && isLikelyUnexposedTenantChatSchema(tenantDataSchema)) {
    return pgResolveChannelIdsForQueueIds(pool, tenantDataSchema, empresaId, ids);
  }

  const { data, error } = await supabase
    .from("chat_queue_channels")
    .select("channel_id")
    .eq("empresa_id", empresaId)
    .in("queue_id", ids);
  if (error) {
    const m = (error.message ?? "").toLowerCase();
    if (
      isInvalidPostgrestSchemaError(error.message) ||
      m.includes("does not exist") ||
      m.includes("schema cache") ||
      m.includes("could not find") ||
      m.includes("undefined_table") ||
      m.includes("chat_queue_channels")
    ) {
      return [];
    }
    console.warn("[resolveChannelIdsForQueueIds]", error.message);
    return [];
  }
  return [
    ...new Set(
      (data ?? []).map((r) => String((r as { channel_id?: string }).channel_id ?? "").trim()).filter(Boolean)
    ),
  ];
}

/** Resolución única para supervisor: equipo + colas ∪ colas supervisadas + canales enlazados a esas colas. */
export async function resolveSupervisorConversationScopeBundle(
  supabase: AppSupabaseClient,
  empresaId: string,
  scope: OmnicanalScope,
  tenantDataSchema?: string
): Promise<SupervisorConversationScopeBundle> {
  if (scope.role !== "supervisor") {
    return { kind: "empty" };
  }
  const agentFkIds = await resolveChatAgentIdsForUsuarios(
    supabase,
    empresaId,
    scope.agentUsuarioIds,
    tenantDataSchema
  );
  const teamQueueIds = await resolveQueueIdsForUsuarios(
    supabase,
    empresaId,
    scope.agentUsuarioIds,
    tenantDataSchema
  );
  const queueIdsUnion = [...new Set([...teamQueueIds, ...(scope.queueIds ?? [])])];
  const channelIdsFromTeamQueues =
    queueIdsUnion.length > 0
      ? await resolveChannelIdsForQueueIds(supabase, empresaId, queueIdsUnion, tenantDataSchema)
      : [];

  if (agentFkIds.length === 0 && queueIdsUnion.length === 0 && channelIdsFromTeamQueues.length === 0) {
    if ((scope.agentUsuarioIds?.length ?? 0) > 0) {
      console.warn(
        "[resolveSupervisorConversationScopeBundle] supervisor sin colas/canales resueltos; alcance vacío."
      );
    }
    return { kind: "empty" };
  }
  return {
    kind: "ok",
    agentFkIds,
    queueIdsUnion,
    channelIdsFromTeamQueues,
  };
}

 
function applySupervisorBundleToQuery(
  q: any,
  b: Extract<SupervisorConversationScopeBundle, { kind: "ok" }>
): any {
  const ors: string[] = [];
  if (b.agentFkIds.length > 0) {
    const aIn = b.agentFkIds.map((id) => `"${normalizeId(id)}"`).join(",");
    ors.push(`assigned_agent_id.in.(${aIn})`);
  }
  if (b.queueIdsUnion.length > 0) {
    const qIn = b.queueIdsUnion.map((id) => `"${normalizeId(id)}"`).join(",");
    ors.push(`and(assigned_agent_id.is.null,queue_id.in.(${qIn}))`);
  }
  if (b.channelIdsFromTeamQueues.length > 0) {
    const cIn = b.channelIdsFromTeamQueues.map((id) => `"${normalizeId(id)}"`).join(",");
    ors.push(`and(assigned_agent_id.is.null,channel_id.in.(${cIn}))`);
  }
  if (ors.length === 0) {
    return q.eq("id", NO_CONVERSATION_MATCH);
  }
  if (ors.length === 1) {
    const o = ors[0] as string;
    if (o.startsWith("assigned_agent_id.in.(")) {
      return q.in("assigned_agent_id", b.agentFkIds);
    }
    if (o.startsWith("and(assigned_agent_id.is.null,queue_id.in.(")) {
      return q.is("assigned_agent_id", null).in("queue_id", b.queueIdsUnion);
    }
    if (o.startsWith("and(assigned_agent_id.is.null,channel_id.in.(")) {
      return q.is("assigned_agent_id", null).in("channel_id", b.channelIdsFromTeamQueues);
    }
  }
  return q.or(ors.join(","));
}

/** UUID imposible para forzar 0 filas (filtro inválido o alcance vacío). */
export const OMNICANAL_IMPOSSIBLE_CONVERSATION_ID = "00000000-0000-0000-0000-000000000001";

const NO_CONVERSATION_MATCH = OMNICANAL_IMPOSSIBLE_CONVERSATION_ID;

/**
 * El builder de PostgREST es “thenable”: devolverlo desde una función `async` sin envoltorio
 * ejecuta la query y devuelve `{ data, error }` → rompe encadenamientos como `.order()`.
 * Siempre devolver `{ builder }` y desempaquetar en el llamador.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OmnicanalScopedPostgrestBuilder = { builder: any };

/**
 * Restringe un query builder de `chat_conversations` al alcance omnicanal.
 * No aplicar si `shouldBypassOmnicanalConversationScope` es true.
 * Admin operativo (`role === admin`) no debe llamar esta función (no-op si se llama).
 */
 
export async function appendOmnicanalConversationScopeToQuery(
  supabase: AppSupabaseClient,
  empresaId: string,
  scope: OmnicanalScope,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  q: any,
  cache?: OmnicanalConversationScopeCache,
  tenantDataSchema?: string
): Promise<OmnicanalScopedPostgrestBuilder> {
  const wrap = (b: any): OmnicanalScopedPostgrestBuilder => ({ builder: b });

  if (isOmnicanalAdminScope(scope)) return wrap(q);

  const ds = tenantDataSchema ?? (await fetchDataSchemaForEmpresaId(empresaId));

  /**
   * Supervisor: asignadas a agentes del equipo, o sin asignar con cola en alcance, o sin asignar cuyo
   * canal esté vinculado a esas colas (cubre `queue_id` aún null en conversación).
   */
  if (scope.role === "supervisor") {
    const bundle = await (() => {
      if (cache?.supervisorBundlePromise) return cache.supervisorBundlePromise;
      const p = resolveSupervisorConversationScopeBundle(supabase, empresaId, scope, ds);
      if (cache) cache.supervisorBundlePromise = p;
      return p;
    })();
    if (bundle.kind === "empty") {
      return wrap(q.eq("id", NO_CONVERSATION_MATCH));
    }
    return wrap(applySupervisorBundleToQuery(q, bundle));
  }

  const agentFkIds = await resolveChatAgentIdsForUsuarios(supabase, empresaId, scope.agentUsuarioIds, ds);
  const queueIds = scope.queueIds ?? [];

  if (queueIds.length === 0 && agentFkIds.length === 0) {
    const hadIntent =
      (scope.agentUsuarioIds?.length ?? 0) > 0 || (scope.queueIds?.length ?? 0) > 0;
    if (hadIntent) {
      console.warn(
        "[appendOmnicanalConversationScopeToQuery] alcance con colas/agentes declarados pero sin ids resueltos; se omite filtro (evita inbox vacío)."
      );
      return wrap(q);
    }
    return wrap(q.eq("id", NO_CONVERSATION_MATCH));
  }
  if (queueIds.length > 0 && agentFkIds.length > 0) {
    const qIn = queueIds.map((id) => `"${normalizeId(id)}"`).join(",");
    const aIn = agentFkIds.map((id) => `"${normalizeId(id)}"`).join(",");
    return wrap(q.or(`queue_id.in.(${qIn}),assigned_agent_id.in.(${aIn})`));
  }
  if (queueIds.length > 0) {
    return wrap(q.in("queue_id", queueIds));
  }
  if (agentFkIds.length === 0) {
    return wrap(q.eq("id", NO_CONVERSATION_MATCH));
  }
  return wrap(q.in("assigned_agent_id", agentFkIds));
}

/**
 * Alcance omnicanal con SQL directo en el schema tenant (schemas `erp_*` no expuestos en PostgREST).
 */
export async function filterConversationIdsByOmnicanalScopePg(
  pool: Pool,
  tenantDataSchema: string,
  supabase: AppSupabaseClient,
  catalogSr: AppSupabaseClient,
  empresaId: string,
  usuarioId: string,
  conversationIds: string[]
): Promise<Set<string>> {
  const ids = [...new Set(conversationIds.map((x) => normalizeId(x)).filter(Boolean))];
  if (ids.length === 0) return new Set();

  const scope = await getOmnicanalScope(supabase, empresaId, usuarioId, { tenantDataSchema });
  if (await shouldBypassOmnicanalConversationScope(catalogSr, usuarioId, scope)) {
    return new Set(ids);
  }

  try {
    const scopeClause = await buildPgOmnicanalConversationScopeAndClause(
      pool,
      tenantDataSchema,
      empresaId,
      scope,
      3
    );
    const qt = quoteSchemaTable(tenantDataSchema, "chat_conversations");
    const q = `
      SELECT id::text AS id FROM ${qt}
      WHERE empresa_id = $1::uuid AND id = ANY($2::uuid[]) AND (${scopeClause.sql})
    `;
    const params: unknown[] = [empresaId, ids, ...scopeClause.params];
    const r = await pool.query(q, params);
    return new Set((r.rows ?? []).map((row: { id?: string }) => String(row.id ?? "").trim()).filter(Boolean));
  } catch (e) {
    console.warn(
      "[filterConversationIdsByOmnicanalScopePg] error; fail-open:",
      e instanceof Error ? e.message : e
    );
    return new Set(ids);
  }
}

/** Filtra ids de conversación que caen dentro del alcance (misma lógica que el append). */
export async function filterConversationIdsByOmnicanalScope(
  supabase: AppSupabaseClient,
  catalogSr: AppSupabaseClient,
  empresaId: string,
  usuarioId: string,
  conversationIds: string[]
): Promise<Set<string>> {
  const ids = [...new Set(conversationIds.map((x) => normalizeId(x)).filter(Boolean))];
  if (ids.length === 0) return new Set();

  const tenantDataSchema = await fetchDataSchemaForEmpresaId(empresaId);
  const pool = getChatPostgresPool();
  if (pool && isLikelyUnexposedTenantChatSchema(tenantDataSchema)) {
    return filterConversationIdsByOmnicanalScopePg(
      pool,
      tenantDataSchema,
      supabase,
      catalogSr,
      empresaId,
      usuarioId,
      ids
    );
  }

  const scope = await getOmnicanalScope(supabase, empresaId, usuarioId, { tenantDataSchema });
  if (await shouldBypassOmnicanalConversationScope(catalogSr, usuarioId, scope)) {
    return new Set(ids);
  }

  try {
    const q = supabase.from("chat_conversations").select("id").eq("empresa_id", empresaId).in("id", ids);
    const { builder } = await appendOmnicanalConversationScopeToQuery(
      supabase,
      empresaId,
      scope,
      q,
      undefined,
      tenantDataSchema
    );
    const { data, error } = await builder;
    if (error) {
      console.warn("[filterConversationIdsByOmnicanalScope] error; fail-open lectura:", error.message);
      return new Set(ids);
    }
    return new Set(
      (data ?? []).map((r: { id?: string }) => String(r.id ?? "").trim()).filter(Boolean)
    );
  } catch (e) {
    console.error("[filterConversationIdsByOmnicanalScope] excepción; fail-open:", e);
    return new Set(ids);
  }
}
