import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import type {
  ChatQueueAdminRow,
  QueueAgentRow,
  QueueClosureStateRow,
  QueueClosureTaxonomyInput,
  QueueEditorChatChannelRow,
  UsuarioPickRow,
} from "@/lib/chat/queue-admin-repo";

type ApiOk<T> = { success: true; data: T };
type ApiErr = { success: false; error: string };

function parseJson<T>(raw: unknown): T {
  return raw as T;
}

export async function apiListQueues(): Promise<ChatQueueAdminRow[]> {
  const res = await fetchWithSupabaseSession("/api/configuracion/colas-queues", { cache: "no-store" });
  const json = parseJson<ApiOk<ChatQueueAdminRow[]> | ApiErr>(await res.json());
  if (!res.ok || !json.success) {
    throw new Error(!json.success ? json.error : "Error al cargar colas");
  }
  return json.data ?? [];
}

export async function apiCreateQueueDraft(): Promise<string> {
  const res = await fetchWithSupabaseSession("/api/configuracion/colas-queues", {
    method: "POST",
    cache: "no-store",
  });
  const json = parseJson<ApiOk<{ id: string }> | ApiErr>(await res.json());
  if (!res.ok || !json.success || !json.data?.id) {
    throw new Error(!json.success ? json.error : "No se pudo crear la cola");
  }
  return String(json.data.id).trim();
}

export type QueueEditorBootstrap = {
  queue: ChatQueueAdminRow | null;
  channels: QueueEditorChatChannelRow[];
  linked: { channel_id: string; channel_nombre: string | null; channel_type: string }[];
  agents: QueueAgentRow[];
  usuarios: UsuarioPickRow[];
  closure_taxonomy: QueueClosureStateRow[];
  bootstrapWarnings?: string[];
};

export async function apiQueueEditorBootstrap(queueId: string): Promise<QueueEditorBootstrap> {
  const q = encodeURIComponent(queueId.trim());
  const res = await fetchWithSupabaseSession(`/api/configuracion/colas-queues/${q}/bootstrap`, {
    cache: "no-store",
  });
  const json = parseJson<ApiOk<QueueEditorBootstrap> | ApiErr>(await res.json());
  if (!res.ok || !json.success) {
    const msg = !json.success ? json.error : res.status === 404 ? "Cola no encontrada" : "Error al cargar editor de cola";
    throw new Error(msg);
  }
  return json.data;
}

export async function apiSaveQueue(
  queueId: string,
  body: {
    nombre: string;
    descripcion: string | null;
    is_active: boolean;
    channel_type: string | null;
    distribution_strategy: string;
    priority: number;
    routing_config?: Record<string, unknown> | null;
  }
): Promise<void> {
  const q = encodeURIComponent(queueId.trim());
  const res = await fetchWithSupabaseSession(`/api/configuracion/colas-queues/${q}`, {
    method: "PATCH",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = parseJson<ApiOk<boolean> | ApiErr>(await res.json());
  if (!res.ok || !json.success) {
    throw new Error(!json.success ? json.error : "Error al guardar cola");
  }
}

export async function apiSetQueueChannelLinks(queueId: string, channelIds: string[]): Promise<void> {
  const q = encodeURIComponent(queueId.trim());
  const res = await fetchWithSupabaseSession(`/api/configuracion/colas-queues/${q}/channel-links`, {
    method: "PUT",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel_ids: channelIds }),
  });
  const json = parseJson<ApiOk<boolean> | ApiErr>(await res.json());
  if (!res.ok || !json.success) {
    throw new Error(!json.success ? json.error : "Error al guardar canales");
  }
}

export async function apiAddQueueAgent(queueId: string, usuarioId: string): Promise<void> {
  const q = encodeURIComponent(queueId.trim());
  const res = await fetchWithSupabaseSession(`/api/configuracion/colas-queues/${q}/agents`, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario_id: usuarioId }),
  });
  const json = parseJson<ApiOk<boolean> | ApiErr>(await res.json());
  if (!res.ok || !json.success) {
    throw new Error(!json.success ? json.error : "Error al añadir agente");
  }
}

export async function apiUpdateQueueAgent(
  queueId: string,
  agentId: string,
  body: {
    max_conversations: number;
    is_online?: boolean;
    is_active: boolean;
    receives_new_chats: boolean;
    priority_in_queue: number;
  }
): Promise<void> {
  const q = encodeURIComponent(queueId.trim());
  const a = encodeURIComponent(agentId.trim());
  const res = await fetchWithSupabaseSession(`/api/configuracion/colas-queues/${q}/agents/${a}`, {
    method: "PATCH",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = parseJson<ApiOk<boolean> | ApiErr>(await res.json());
  if (!res.ok || !json.success) {
    throw new Error(!json.success ? json.error : "Error al actualizar agente");
  }
}

export async function apiRemoveQueueAgent(queueId: string, agentId: string): Promise<void> {
  const q = encodeURIComponent(queueId.trim());
  const a = encodeURIComponent(agentId.trim());
  const res = await fetchWithSupabaseSession(`/api/configuracion/colas-queues/${q}/agents/${a}`, {
    method: "DELETE",
    cache: "no-store",
  });
  const json = parseJson<ApiOk<boolean> | ApiErr>(await res.json());
  if (!res.ok || !json.success) {
    throw new Error(!json.success ? json.error : "Error al quitar agente");
  }
}

export async function apiDeleteQueue(queueId: string): Promise<void> {
  const q = encodeURIComponent(queueId.trim());
  const res = await fetchWithSupabaseSession(`/api/configuracion/colas-queues/${q}`, {
    method: "DELETE",
    cache: "no-store",
  });
  const json = parseJson<ApiOk<boolean> | ApiErr>(await res.json());
  if (!res.ok || !json.success) {
    throw new Error(!json.success ? json.error : "Error al eliminar cola");
  }
}

export async function apiSaveClosureTaxonomy(queueId: string, states: QueueClosureTaxonomyInput[]): Promise<void> {
  const q = encodeURIComponent(queueId.trim());
  const res = await fetchWithSupabaseSession(`/api/configuracion/colas-queues/${q}/closure-config`, {
    method: "PUT",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ states }),
  });
  const json = parseJson<ApiOk<boolean> | ApiErr>(await res.json());
  if (!res.ok || !json.success) {
    throw new Error(!json.success ? json.error : "Error al guardar estados de cierre");
  }
}
