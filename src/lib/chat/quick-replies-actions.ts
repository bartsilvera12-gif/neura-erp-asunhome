"use server";

import { pgChannelBelongsToEmpresa, pgListActiveQuickRepliesForChannel } from "@/lib/chat/chat-quick-replies-pg";
import { requireEmpresaTenantServiceRole } from "@/lib/chat/empresa-tenant-service-role";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { isLikelyUnexposedTenantChatSchema } from "@/lib/supabase/chat-data-schema";

export type ChannelQuickReplyRow = {
  id: string;
  empresa_id: string;
  channel_id: string;
  title: string;
  body: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

async function assertChannelBelongsToEmpresa(
  supabase: Awaited<ReturnType<typeof requireEmpresaTenantServiceRole>>["supabase"],
  empresaId: string,
  channelId: string
) {
  const { data, error } = await supabase
    .from("chat_channels")
    .select("id")
    .eq("id", channelId.trim())
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Canal no encontrado o sin permiso.");
}

/** Listado para inbox: solo activas, ordenadas. */
export async function listActiveQuickRepliesForChannel(channelId: string): Promise<ChannelQuickReplyRow[]> {
  const { supabase, empresa_id, dataSchema } = await requireEmpresaTenantServiceRole();
  const cid = channelId.trim();
  if (!cid) return [];

  const pool = getChatPostgresPool();
  if (pool && isLikelyUnexposedTenantChatSchema(dataSchema)) {
    const ok = await pgChannelBelongsToEmpresa(pool, dataSchema, empresa_id, cid);
    if (!ok) throw new Error("Canal no encontrado o sin permiso.");
    const rows = await pgListActiveQuickRepliesForChannel(pool, dataSchema, empresa_id, cid);
    return rows as ChannelQuickReplyRow[];
  }

  await assertChannelBelongsToEmpresa(supabase, empresa_id, cid);

  const { data, error } = await supabase
    .from("chat_channel_quick_replies")
    .select(
      "id, empresa_id, channel_id, title, body, sort_order, is_active, created_at, updated_at"
    )
    .eq("empresa_id", empresa_id)
    .eq("channel_id", cid)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("title", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as ChannelQuickReplyRow[];
}

/** Gestión en configuración: todas las filas. */
export async function listAllQuickRepliesForChannel(channelId: string): Promise<ChannelQuickReplyRow[]> {
  const { supabase, empresa_id } = await requireEmpresaTenantServiceRole();
  const cid = channelId.trim();
  if (!cid) return [];
  await assertChannelBelongsToEmpresa(supabase, empresa_id, cid);

  const { data, error } = await supabase
    .from("chat_channel_quick_replies")
    .select(
      "id, empresa_id, channel_id, title, body, sort_order, is_active, created_at, updated_at"
    )
    .eq("empresa_id", empresa_id)
    .eq("channel_id", cid)
    .order("sort_order", { ascending: true })
    .order("title", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as ChannelQuickReplyRow[];
}

export async function createChannelQuickReply(input: {
  channelId: string;
  title: string;
  body: string;
  sortOrder?: number;
}): Promise<void> {
  const { supabase, empresa_id } = await requireEmpresaTenantServiceRole();
  const channelId = input.channelId.trim();
  const title = input.title.trim();
  const body = input.body.trim();
  if (!channelId || !title || !body) throw new Error("Completá título y texto.");

  await assertChannelBelongsToEmpresa(supabase, empresa_id, channelId);

  const { error } = await supabase.from("chat_channel_quick_replies").insert({
    empresa_id,
    channel_id: channelId,
    title,
    body,
    sort_order: typeof input.sortOrder === "number" ? input.sortOrder : 0,
    is_active: true,
  });

  if (error) throw new Error(error.message);
}

export async function updateChannelQuickReply(input: {
  id: string;
  title?: string;
  body?: string;
  sortOrder?: number;
  isActive?: boolean;
}): Promise<void> {
  const { supabase, empresa_id } = await requireEmpresaTenantServiceRole();
  const id = input.id.trim();
  if (!id) throw new Error("ID inválido.");

  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) {
    const t = input.title.trim();
    if (!t) throw new Error("El título no puede quedar vacío.");
    patch.title = t;
  }
  if (input.body !== undefined) {
    const b = input.body.trim();
    if (!b) throw new Error("El texto no puede quedar vacío.");
    patch.body = b;
  }
  if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
  if (input.isActive !== undefined) patch.is_active = input.isActive;

  if (Object.keys(patch).length === 0) return;

  const { data: existing, error: exErr } = await supabase
    .from("chat_channel_quick_replies")
    .select("id")
    .eq("id", id)
    .eq("empresa_id", empresa_id)
    .maybeSingle();
  if (exErr) throw new Error(exErr.message);
  if (!existing) throw new Error("Respuesta rápida no encontrada.");

  const { error } = await supabase.from("chat_channel_quick_replies").update(patch).eq("id", id).eq(
    "empresa_id",
    empresa_id
  );

  if (error) throw new Error(error.message);
}

export async function deleteChannelQuickReply(id: string): Promise<void> {
  const { supabase, empresa_id } = await requireEmpresaTenantServiceRole();
  const rid = id.trim();
  if (!rid) throw new Error("ID inválido.");

  const { error } = await supabase
    .from("chat_channel_quick_replies")
    .delete()
    .eq("id", rid)
    .eq("empresa_id", empresa_id);

  if (error) throw new Error(error.message);
}
