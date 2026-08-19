/**
 * Helpers puros extraídos de ConversacionesClient.tsx. Sin estado de React,
 * sin side effects. Mover acá:
 *   - Reduce 200+ líneas del componente monolítico (era 2902 líneas).
 *   - Permite testear los helpers en aislamiento si en el futuro hace falta.
 *   - Permite que otros componentes del módulo conversaciones los reutilicen
 *     sin importar el monolito completo.
 *
 * NO importa nada que dependa de React (useState, useEffect, hooks).
 */

import {
  getErpAttachmentCaption,
  getErpAttachmentFilename,
  getErpAttachmentPublicUrl,
  getMetaInboundDocumentFilename,
  getWhatsAppMediaUrlFromRawPayload,
} from "@/lib/chat/message-erp-display";
import type {
  ChatChannelRow,
  ChatInboxAssignmentFilter,
  ChatInboxFilters,
  InboxConversation,
} from "@/lib/chat/actions";
import type { ChatMessage } from "./types";

export function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("es-PY", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function mapRowToMessage(row: Record<string, unknown>): ChatMessage {
  return {
    id: row.id as string,
    from_me: Boolean(row.from_me),
    message_type: String(row.message_type ?? "text"),
    content: (row.content as string | null) ?? null,
    created_at: String(row.created_at),
    raw_payload:
      typeof row.raw_payload === "object" && row.raw_payload !== null
        ? (row.raw_payload as Record<string, unknown>)
        : null,
  };
}

export function parseOutgoingImageMessage(message: ChatMessage): { url: string | null; caption: string | null } {
  const erpUrl = getErpAttachmentPublicUrl(message.raw_payload);
  if (erpUrl) {
    const cap = getErpAttachmentCaption(message.raw_payload) ?? getErpAttachmentFilename(message.raw_payload);
    return { url: erpUrl, caption: cap };
  }
  const waUrl = getWhatsAppMediaUrlFromRawPayload(message.raw_payload);
  if (waUrl) {
    const imagePayload = (message.raw_payload?.image as { caption?: string } | undefined) ?? {};
    const cap = typeof imagePayload.caption === "string" ? imagePayload.caption.trim() : "";
    return { url: waUrl, caption: cap || null };
  }
  const imagePayload = (message.raw_payload?.image as { link?: string; caption?: string } | undefined) ?? {};
  const link = typeof imagePayload.link === "string" ? imagePayload.link.trim() : "";
  const captionFromPayload = typeof imagePayload.caption === "string" ? imagePayload.caption.trim() : "";
  if (link) return { url: link, caption: captionFromPayload || null };

  const lines = (message.content ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const urlLine = lines.find((line) => /^https?:\/\//i.test(line)) ?? null;
  const captionLine = lines.find((line) => !/^https?:\/\//i.test(line) && !/^Imagen enviada:?/i.test(line)) ?? null;
  return { url: urlLine, caption: captionLine };
}

export function resolveAttachmentUrl(message: ChatMessage): string | null {
  return (
    getErpAttachmentPublicUrl(message.raw_payload) ??
    getWhatsAppMediaUrlFromRawPayload(message.raw_payload) ??
    parseOutgoingImageMessage(message).url
  );
}

export function displayFilenameForAttachment(message: ChatMessage): string {
  const erp = getErpAttachmentFilename(message.raw_payload);
  if (erp) return erp;
  const meta = getMetaInboundDocumentFilename(message.raw_payload);
  if (meta) return meta;
  const raw = (message.content ?? "").trim();
  const m = /^\[documento\]\s*(.+)$/i.exec(raw);
  if (m?.[1]?.trim()) return m[1].trim();
  if (raw && !raw.startsWith("[")) return raw.slice(0, 120);
  return message.message_type === "video" ? "Video" : "Archivo";
}

export function tabClass(active: boolean) {
  return `px-3 py-2 text-xs font-semibold rounded-lg transition-colors ${
    active ? "bg-white text-slate-800 shadow-sm border border-slate-200" : "text-slate-500 hover:text-slate-700"
  }`;
}

/**
 * Control segmentado: el modo activo = pastilla blanca con borde de color (no "todo verde");
 * el inactivo = gris plano (se entiende qué está elegido).
 */
export function opPresenceToggleClass(isSelected: boolean, variant: "ready" | "offline") {
  const base =
    "px-3 py-1.5 text-xs font-semibold rounded-md transition-all disabled:opacity-50 min-w-[6.75rem] text-center border-2";
  if (!isSelected) {
    return `${base} border-transparent bg-slate-200/60 text-slate-500 hover:bg-slate-200 hover:text-slate-600`;
  }
  if (variant === "ready") {
    return `${base} border-emerald-500 bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-200/90 z-[1]`;
  }
  return `${base} border-slate-600 bg-white text-slate-800 shadow-sm ring-1 ring-slate-200/90 z-[1]`;
}

export function inboxClientWaitingSince(c: InboxConversation): string | null {
  if (c.awaiting_agent_reply_since) return null;
  return c.awaiting_client_reply_since ?? null;
}

export function parseInboxFilters(sp: URLSearchParams): ChatInboxFilters | undefined {
  const rawA = sp.get("asignacion");
  const assignment: ChatInboxAssignmentFilter =
    rawA === "mios" ? "mine" : rawA === "sin_asignar" ? "unassigned" : "all";
  const queue_id = sp.get("cola")?.trim() || null;
  const channel_id = sp.get("canal")?.trim() || null;
  const statusRaw = sp.get("estado")?.trim().toLowerCase() || null;
  const priorityRaw = sp.get("prioridad")?.trim().toLowerCase() || null;
  const status =
    statusRaw && ["open", "pending", "closed"].includes(statusRaw) ? statusRaw : null;
  const priority =
    priorityRaw && ["low", "medium", "high"].includes(priorityRaw) ? priorityRaw : null;
  const has =
    assignment !== "all" ||
    (queue_id && queue_id.length > 0) ||
    status !== null ||
    priority !== null ||
    (channel_id && channel_id.length > 0);
  if (!has) return undefined;
  return {
    assignment,
    queue_id: queue_id && queue_id.length > 0 ? queue_id : null,
    status,
    priority,
    channel_id: channel_id && channel_id.length > 0 ? channel_id : null,
  };
}

export function formatChannelOptionLabel(c: ChatChannelRow): string {
  const name = (c.nombre ?? "").trim() || "Canal";
  const kind = [c.type, c.provider].filter(Boolean).join(" / ");
  const mp = c.meta_phone_number_id?.trim();
  const tail =
    mp && mp.length > 0
      ? ` · ${mp.length > 18 ? `${mp.slice(0, 16)}…` : mp}`
      : "";
  return `${name} · ${kind}${tail}`;
}

export function labelEstado(s: string) {
  if (s === "open") return "Abierta";
  if (s === "pending") return "Pendiente";
  if (s === "closed") return "Cerrada";
  return s;
}

export function badgeEstadoClass(s: string) {
  if (s === "open") return "text-sky-800 bg-sky-50 border-sky-200";
  if (s === "pending") return "text-amber-800 bg-amber-50 border-amber-200";
  if (s === "closed") return "text-slate-600 bg-slate-100 border-slate-200";
  return "text-slate-600 bg-slate-50 border-slate-200";
}

export function omnicanalRoleBadgeClass(role: string | null): string {
  if (role === "admin") return "text-slate-800 bg-slate-100 border-slate-200";
  if (role === "supervisor") return "text-sky-800 bg-sky-50 border-sky-200";
  if (role === "agente") return "text-indigo-900 bg-indigo-50 border-indigo-200";
  return "text-slate-600 bg-slate-50 border-slate-200";
}

export function omnicanalRoleShortLabel(role: string | null): string | null {
  if (!role) return null;
  if (role === "admin") return "Admin";
  if (role === "supervisor") return "Supervisor";
  if (role === "agente") return "Agente";
  return null;
}

/**
 * Debug log condicional para tracear el flujo de chat-list. Activar con
 * NEXT_PUBLIC_CHAT_LIST_DEBUG=true en .env.local (solo dev/staging).
 */
const CHAT_LIST_DEBUG = process.env.NEXT_PUBLIC_CHAT_LIST_DEBUG === "true";
export function chatListUiLog(
  sub: "initial-data" | "refetch-start" | "refetch-result" | "set-conversations" | "filters-applied" | "tab-split" | "refetch-preserve",
  payload: Record<string, unknown>
) {
  if (!CHAT_LIST_DEBUG) return;
  console.info(`[chat-ui][${sub}]`, { ...payload, timestamp: new Date().toISOString() });
}
