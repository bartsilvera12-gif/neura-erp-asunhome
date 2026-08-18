import type { SupabaseAdmin } from "@/lib/chat/types";

export type HistoryFilters = {
  channelId?: string;
  from?: string;
  to?: string;
};

export type HistorySearchItem = {
  contact_id: string;
  name: string | null;
  phone: string;
  total_conversations: number;
  total_messages: number;
  last_message_at: string | null;
  handled_by_ai: boolean;
  handled_by_human: boolean;
};

export type ContactHistoryMessage = {
  id: string;
  conversation_id: string;
  created_at: string;
  from_me: boolean;
  sender_type: "contact" | "ai" | "human" | "system";
  sent_by_user_id: string | null;
  sent_by_user_name: string | null;
  automation_source: string | null;
  message_type: string;
  content: string | null;
  raw_payload?: Record<string, unknown> | null;
};

export type ContactHistoryConversation = {
  id: string;
  channel_id: string;
  channel_name: string;
  status: string;
  last_message_at: string | null;
  unread_count: number;
  messages: ContactHistoryMessage[];
};

export type ContactHistoryDetail = {
  contact: {
    id: string;
    name: string | null;
    phone_number: string;
    phone_normalized: string | null;
    cliente_id: string | null;
    crm_prospecto_id: string | null;
  };
  stats: {
    total_conversations: number;
    total_messages: number;
    last_message_at: string | null;
    handled_by_ai: boolean;
    handled_by_human: boolean;
  };
  conversations: ContactHistoryConversation[];
};

export function normalizePhone(input: string): string {
  return input.replace(/\D/g, "");
}

function sanitizeTerm(q: string): string {
  return q.trim().slice(0, 120);
}

function inDateRange(iso: string, filters?: HistoryFilters): boolean {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return true;
  if (filters?.from) {
    const fromTs = new Date(filters.from).getTime();
    if (!Number.isNaN(fromTs) && ts < fromTs) return false;
  }
  if (filters?.to) {
    const toTs = new Date(filters.to).getTime();
    if (!Number.isNaN(toTs) && ts > toTs) return false;
  }
  return true;
}

export async function searchHistoryContacts(
  supabase: SupabaseAdmin,
  empresaId: string,
  q: string,
  filters?: HistoryFilters
): Promise<HistorySearchItem[]> {
  const term = sanitizeTerm(q);
  if (!term) return [];

  const digits = normalizePhone(term);
  let contactQuery = supabase
    .from("chat_contacts")
    .select("id, name, phone_number, phone_normalized")
    .eq("empresa_id", empresaId)
    .limit(40);

  if (digits.length >= 3) {
    contactQuery = contactQuery.or(
      `name.ilike.%${term}%,phone_number.ilike.%${digits}%,phone_normalized.ilike.%${digits}%`
    );
  } else {
    contactQuery = contactQuery.ilike("name", `%${term}%`);
  }

  const { data: contacts, error: cErr } = await contactQuery;
  if (cErr) throw new Error(cErr.message);
  if (!contacts?.length) return [];

  const contactIds = contacts.map((c) => c.id as string);
  let convQuery = supabase
    .from("chat_conversations")
    .select("id, contact_id, channel_id, last_message_at")
    .eq("empresa_id", empresaId)
    .in("contact_id", contactIds);

  if (filters?.channelId) convQuery = convQuery.eq("channel_id", filters.channelId);

  const { data: convs, error: convErr } = await convQuery;
  if (convErr) throw new Error(convErr.message);

  const convList = convs ?? [];
  const convIds = convList.map((c) => c.id as string);
  const messagesByConversation = new Map<string, ContactHistoryMessage[]>();

  if (convIds.length > 0) {
    const { data: msgRows, error: mErr } = await supabase
      .from("chat_messages")
      .select(
        "id, conversation_id, created_at, from_me, sender_type, sent_by_user_id, sent_by_user_name, automation_source, message_type, content, raw_payload"
      )
      .eq("empresa_id", empresaId)
      .in("conversation_id", convIds)
      .order("created_at", { ascending: true });
    if (mErr) throw new Error(mErr.message);

    for (const row of msgRows ?? []) {
      const msg = row as unknown as ContactHistoryMessage;
      if (!inDateRange(msg.created_at, filters)) continue;
      const list = messagesByConversation.get(msg.conversation_id) ?? [];
      list.push(msg);
      messagesByConversation.set(msg.conversation_id, list);
    }
  }

  const convByContact = new Map<string, Array<{ id: string; last_message_at: string | null }>>();
  for (const c of convList) {
    const id = c.id as string;
    if ((messagesByConversation.get(id)?.length ?? 0) === 0) continue;
    const contactId = c.contact_id as string;
    const list = convByContact.get(contactId) ?? [];
    list.push({ id, last_message_at: (c.last_message_at as string | null) ?? null });
    convByContact.set(contactId, list);
  }

  const out: HistorySearchItem[] = [];
  for (const c of contacts) {
    const contactId = c.id as string;
    const contactConvs = convByContact.get(contactId) ?? [];
    const msgs = contactConvs.flatMap((conv) => messagesByConversation.get(conv.id) ?? []);
    if (msgs.length === 0) continue;

    out.push({
      contact_id: contactId,
      name: (c.name as string | null) ?? null,
      phone: (c.phone_number as string) ?? "",
      total_conversations: contactConvs.length,
      total_messages: msgs.length,
      last_message_at: msgs[msgs.length - 1]?.created_at ?? null,
      handled_by_ai: msgs.some((m) => m.sender_type === "ai"),
      handled_by_human: msgs.some((m) => m.sender_type === "human"),
    });
  }

  out.sort((a, b) => {
    const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
    const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
    return tb - ta;
  });
  return out;
}

export async function getContactHistory(
  supabase: SupabaseAdmin,
  empresaId: string,
  contactId: string,
  filters?: HistoryFilters
): Promise<ContactHistoryDetail | null> {
  const { data: contact, error: cErr } = await supabase
    .from("chat_contacts")
    .select("id, name, phone_number, phone_normalized, cliente_id, crm_prospecto_id")
    .eq("empresa_id", empresaId)
    .eq("id", contactId)
    .maybeSingle();

  if (cErr) throw new Error(cErr.message);
  if (!contact) return null;

  let convQuery = supabase
    .from("chat_conversations")
    .select("id, channel_id, status, unread_count, last_message_at")
    .eq("empresa_id", empresaId)
    .eq("contact_id", contactId)
    .order("last_message_at", { ascending: false });

  if (filters?.channelId) convQuery = convQuery.eq("channel_id", filters.channelId);

  const { data: convs, error: convErr } = await convQuery;
  if (convErr) throw new Error(convErr.message);

  const convList = convs ?? [];
  const convIds = convList.map((c) => c.id as string);
  const channels = new Map<string, string>();
  if (convList.length > 0) {
    const channelIds = [...new Set(convList.map((c) => c.channel_id as string))];
    const { data: chRows } = await supabase
      .from("chat_channels")
      .select("id, nombre")
      .eq("empresa_id", empresaId)
      .in("id", channelIds);
    for (const row of chRows ?? []) {
      channels.set(row.id as string, ((row.nombre as string | null) ?? "Canal").trim() || "Canal");
    }
  }

  const messagesByConversation = new Map<string, ContactHistoryMessage[]>();
  if (convIds.length > 0) {
    const { data: msgRows, error: msgErr } = await supabase
      .from("chat_messages")
      .select(
        "id, conversation_id, created_at, from_me, sender_type, sent_by_user_id, sent_by_user_name, automation_source, message_type, content, raw_payload"
      )
      .eq("empresa_id", empresaId)
      .in("conversation_id", convIds)
      .order("created_at", { ascending: true });
    if (msgErr) throw new Error(msgErr.message);

    for (const row of msgRows ?? []) {
      const msg = row as unknown as ContactHistoryMessage;
      if (!inDateRange(msg.created_at, filters)) continue;
      const list = messagesByConversation.get(msg.conversation_id) ?? [];
      list.push(msg);
      messagesByConversation.set(msg.conversation_id, list);
    }
  }

  const conversations: ContactHistoryConversation[] = convList
    .map((conv) => {
      const conversationId = conv.id as string;
      const msgs = messagesByConversation.get(conversationId) ?? [];
      return {
        id: conversationId,
        channel_id: conv.channel_id as string,
        channel_name: channels.get(conv.channel_id as string) ?? "Canal",
        status: (conv.status as string) ?? "open",
        last_message_at: msgs[msgs.length - 1]?.created_at ?? (conv.last_message_at as string | null) ?? null,
        unread_count: (conv.unread_count as number) ?? 0,
        messages: msgs,
      };
    })
    .filter((c) => c.messages.length > 0);

  const allMessages = conversations.flatMap((c) => c.messages);

  return {
    contact: {
      id: contact.id as string,
      name: (contact.name as string | null) ?? null,
      phone_number: (contact.phone_number as string) ?? "",
      phone_normalized: (contact.phone_normalized as string | null) ?? null,
      cliente_id: (contact.cliente_id as string | null) ?? null,
      crm_prospecto_id: (contact.crm_prospecto_id as string | null) ?? null,
    },
    stats: {
      total_conversations: conversations.length,
      total_messages: allMessages.length,
      last_message_at: allMessages[allMessages.length - 1]?.created_at ?? null,
      handled_by_ai: allMessages.some((m) => m.sender_type === "ai"),
      handled_by_human: allMessages.some((m) => m.sender_type === "human"),
    },
    conversations,
  };
}
