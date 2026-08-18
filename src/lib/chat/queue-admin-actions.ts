"use server";

import { requireEmpresaTenantServiceRole } from "@/lib/chat/empresa-tenant-service-role";
import {
  repoAddAgentToQueue,
  repoCreateQueueDraft,
  repoDeleteQueue,
  repoFetchQueue,
  repoListAgentsForQueue,
  repoListQueueChannelLinks,
  repoListQueues,
  repoListAgentesForEquiposPick,
  repoListSupervisoresForEquiposPick,
  repoListUsuariosForQueuePick,
  repoRemoveQueueAgent,
  repoSaveQueue,
  repoSetQueueChannelLinks,
  repoUpdateQueueAgent,
} from "@/lib/chat/queue-admin-repo";

export type ChatQueueAdminRow = import("@/lib/chat/queue-admin-repo").ChatQueueAdminRow;
export type QueueChannelLink = import("@/lib/chat/queue-admin-repo").QueueChannelLink;
export type QueueAgentRow = import("@/lib/chat/queue-admin-repo").QueueAgentRow;
export type UsuarioPickRow = import("@/lib/chat/queue-admin-repo").UsuarioPickRow;

async function ctx() {
  const { supabase, catalogSr, empresa_id } = await requireEmpresaTenantServiceRole();
  return { supabase, catalogSr, empresa_id };
}

export async function listQueuesAdmin(): Promise<ChatQueueAdminRow[]> {
  return repoListQueues(await ctx());
}

export async function fetchQueueAdmin(queueId: string): Promise<ChatQueueAdminRow | null> {
  return repoFetchQueue(await ctx(), queueId);
}

export async function createQueueDraft(): Promise<string> {
  return repoCreateQueueDraft(await ctx());
}

export async function saveQueueAdmin(input: {
  id: string;
  nombre: string;
  descripcion?: string | null;
  is_active: boolean;
  channel_type?: string | null;
  distribution_strategy: string;
  priority?: number;
}): Promise<void> {
  return repoSaveQueue(await ctx(), input);
}

export async function deleteQueueAdmin(queueId: string): Promise<void> {
  return repoDeleteQueue(await ctx(), queueId);
}

export async function listQueueChannelLinks(queueId: string): Promise<QueueChannelLink[]> {
  return repoListQueueChannelLinks(await ctx(), queueId);
}

export async function setQueueChannelLinks(queueId: string, channelIds: string[]): Promise<void> {
  return repoSetQueueChannelLinks(await ctx(), queueId, channelIds);
}

export async function listAgentsForQueue(queueId: string): Promise<QueueAgentRow[]> {
  return repoListAgentsForQueue(await ctx(), queueId);
}

export async function addAgentToQueue(input: {
  queue_id: string;
  usuario_id: string;
  max_conversations?: number;
  receives_new_chats?: boolean;
  priority_in_queue?: number;
}): Promise<void> {
  return repoAddAgentToQueue(await ctx(), input);
}

export async function updateQueueAgent(input: {
  id: string;
  max_conversations: number;
  is_online?: boolean;
  is_active: boolean;
  receives_new_chats: boolean;
  priority_in_queue: number;
}): Promise<void> {
  return repoUpdateQueueAgent(await ctx(), input);
}

export async function removeQueueAgent(agentId: string): Promise<void> {
  return repoRemoveQueueAgent(await ctx(), agentId);
}

export async function listUsuariosForQueuePick(): Promise<UsuarioPickRow[]> {
  return repoListUsuariosForQueuePick(await ctx());
}

/** Selector equipos: rol ERP supervisor. */
export async function listSupervisoresForEquiposPick(): Promise<UsuarioPickRow[]> {
  return repoListSupervisoresForEquiposPick(await ctx());
}

/** Selector equipos: rol ERP usuario + membresía activa en alguna cola (`chat_agents`). */
export async function listAgentesForEquiposPick(): Promise<UsuarioPickRow[]> {
  return repoListAgentesForEquiposPick(await ctx());
}
