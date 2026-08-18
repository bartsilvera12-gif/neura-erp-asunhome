"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ContactHistoryDetail, HistorySearchItem } from "@/lib/chat/history-service";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { getErpAttachmentPublicUrl } from "@/lib/chat/message-erp-display";

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-PY", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function SenderBadge({
  senderType,
  fromMe,
}: {
  senderType: "contact" | "ai" | "human" | "system";
  fromMe: boolean;
}) {
  const tone =
    senderType === "contact"
      ? "bg-slate-100 text-slate-700 border-slate-200"
      : senderType === "ai"
        ? "bg-violet-100 text-violet-800 border-violet-200"
        : senderType === "human"
          ? "bg-sky-100 text-sky-800 border-sky-200"
          : "bg-amber-100 text-amber-800 border-amber-200";
  const label =
    senderType === "contact"
      ? "Cliente"
      : senderType === "ai"
        ? "IA"
        : senderType === "human"
          ? "Humano"
          : "Sistema";
  return (
    <span className={`text-[11px] border rounded-full px-2 py-0.5 ${tone}`}>
      {label} · {fromMe ? "Saliente" : "Entrante"}
    </span>
  );
}

export default function HistorialPage() {
  const [q, setQ] = useState("");
  const [channel, setChannel] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [searching, setSearching] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<HistorySearchItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ContactHistoryDetail | null>(null);

  const selectedSummary = useMemo(
    () => results.find((r) => r.contact_id === selectedId) ?? null,
    [results, selectedId]
  );

  async function runSearch() {
    const term = q.trim();
    if (!term) {
      setResults([]);
      setDetail(null);
      setSelectedId(null);
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q: term });
      if (channel.trim()) params.set("channel", channel.trim());
      if (from) params.set("from", new Date(from).toISOString());
      if (to) params.set("to", new Date(`${to}T23:59:59`).toISOString());
      const res = await fetchWithSupabaseSession(`/api/chat/history/search?${params.toString()}`, {
        credentials: "same-origin",
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        items?: HistorySearchItem[];
      };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Error en búsqueda");
      const items = json.items ?? [];
      setResults(items);
      const nextId = items[0]?.contact_id ?? null;
      setSelectedId(nextId);
      setDetail(null);
      if (nextId) {
        await openDetail(nextId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error buscando historial");
    } finally {
      setSearching(false);
    }
  }

  async function openDetail(contactId: string) {
    setSelectedId(contactId);
    setLoadingDetail(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (channel.trim()) params.set("channel", channel.trim());
      if (from) params.set("from", new Date(from).toISOString());
      if (to) params.set("to", new Date(`${to}T23:59:59`).toISOString());
      const qs = params.toString();
      const res = await fetchWithSupabaseSession(
        `/api/chat/history/contact/${contactId}${qs ? `?${qs}` : ""}`,
        { credentials: "same-origin" }
      );
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        detail?: ContactHistoryDetail;
      };
      if (!res.ok || !json.ok || !json.detail) {
        throw new Error(json.error ?? "No se pudo abrir el detalle");
      }
      setDetail(json.detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al abrir detalle");
      setDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  }

  return (
    <div className="h-[calc(100vh-8rem)] min-h-[560px] flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Historial Omnicanal</h1>
          <p className="text-sm text-slate-500">
            Auditoría por contacto: IA + humano + sistema + cliente
          </p>
        </div>
        <Link
          href="/dashboard/conversaciones"
          className="text-sm font-medium text-[#0EA5E9] hover:underline px-3 py-2 rounded-lg border border-sky-200 bg-sky-50"
        >
          Ir a inbox
        </Link>
      </div>

      <div className="border border-slate-200 rounded-xl bg-white p-4 grid grid-cols-1 md:grid-cols-5 gap-3">
        <input
          className="md:col-span-2 border border-slate-200 rounded-lg px-3 py-2 text-sm"
          placeholder="Buscar por nombre o teléfono"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void runSearch();
            }
          }}
        />
        <input
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          placeholder="Filtro channel_id (opcional)"
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
        />
        <input
          type="date"
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <input
          type="date"
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <button
          type="button"
          onClick={() => void runSearch()}
          disabled={searching}
          className="md:col-span-5 justify-self-start bg-[#0EA5E9] hover:bg-[#0284C7] disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          {searching ? "Buscando..." : "Buscar historial"}
        </button>
      </div>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</div>}

      <div className="flex flex-1 min-h-0 border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
        <aside className="w-full max-w-[360px] border-r border-slate-200 bg-slate-50/80 overflow-y-auto">
          <div className="p-3 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Contactos encontrados
          </div>
          {results.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">Buscá un contacto para ver su historial.</div>
          ) : (
            results.map((item) => (
              <button
                key={item.contact_id}
                type="button"
                onClick={() => void openDetail(item.contact_id)}
                className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-white transition-colors ${
                  selectedId === item.contact_id ? "bg-white border-l-4 border-l-[#0EA5E9]" : ""
                }`}
              >
                <p className="font-medium text-slate-800 truncate">{item.name || item.phone}</p>
                <p className="text-xs font-mono text-slate-500">{item.phone}</p>
                <p className="text-xs text-slate-500 mt-1">
                  {item.total_conversations} conv · {item.total_messages} msg
                </p>
              </button>
            ))
          )}
        </aside>

        <section className="flex-1 min-w-0 flex flex-col">
          {!selectedId ? (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
              Seleccioná un contacto
            </div>
          ) : loadingDetail ? (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
              Cargando historial...
            </div>
          ) : !detail ? (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
              No se pudo cargar detalle
            </div>
          ) : (
            <>
              <div className="p-4 border-b border-slate-200 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-slate-800">{detail.contact.name || detail.contact.phone_number}</h2>
                  <span className="text-xs font-mono text-slate-500">{detail.contact.phone_number}</span>
                  {detail.contact.cliente_id && (
                    <Link href={`/clientes/${detail.contact.cliente_id}`} className="text-xs text-[#0EA5E9] hover:underline">
                      Ver cliente
                    </Link>
                  )}
                  {detail.contact.crm_prospecto_id && (
                    <Link href={`/crm/${detail.contact.crm_prospecto_id}`} className="text-xs text-violet-600 hover:underline">
                      Ver prospecto CRM
                    </Link>
                  )}
                </div>
                <div className="text-xs text-slate-500 flex flex-wrap gap-3">
                  <span>{detail.stats.total_conversations} conversaciones</span>
                  <span>{detail.stats.total_messages} mensajes</span>
                  <span>Último: {fmtDate(detail.stats.last_message_at)}</span>
                  <span>IA: {detail.stats.handled_by_ai ? "sí" : "no"}</span>
                  <span>Humano: {detail.stats.handled_by_human ? "sí" : "no"}</span>
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 bg-slate-50/40">
                {detail.conversations.map((conv) => (
                  <article key={conv.id} className="border border-slate-200 rounded-xl bg-white">
                    <header className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm text-slate-700">
                        <strong>{conv.channel_name}</strong> · estado {conv.status}
                      </div>
                      <Link
                        href={`/dashboard/conversaciones?conversationId=${conv.id}`}
                        className="text-xs text-[#0EA5E9] hover:underline"
                      >
                        Abrir conversación actual
                      </Link>
                    </header>
                    <div className="px-4 py-3 space-y-3">
                      {conv.messages.map((msg) => (
                        <div key={msg.id} className={`flex ${msg.from_me ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[90%] rounded-xl px-3 py-2 text-sm ${msg.from_me ? "bg-sky-500 text-white" : "bg-slate-100 text-slate-800"}`}>
                            <div className="flex flex-wrap gap-2 mb-1">
                              <SenderBadge senderType={msg.sender_type} fromMe={msg.from_me} />
                              {msg.sent_by_user_name && (
                                <span className="text-[11px] bg-white/20 border rounded-full px-2 py-0.5">
                                  {msg.sent_by_user_name}
                                </span>
                              )}
                              {msg.automation_source && (
                                <span className="text-[11px] bg-white/20 border rounded-full px-2 py-0.5">
                                  {msg.automation_source}
                                </span>
                              )}
                            </div>
                            <div className="whitespace-pre-wrap break-words space-y-2">
                              {(() => {
                                const url =
                                  typeof msg.raw_payload === "object" && msg.raw_payload !== null
                                    ? getErpAttachmentPublicUrl(
                                        msg.raw_payload as Record<string, unknown>
                                      )
                                    : null;
                                if (msg.message_type === "image" && url) {
                                  return (
                                    <>
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img
                                        src={url}
                                        alt=""
                                        className="max-h-40 rounded-lg border border-white/20"
                                      />
                                      {msg.content && msg.content !== "[imagen]" ? (
                                        <span>{msg.content}</span>
                                      ) : null}
                                    </>
                                  );
                                }
                                return (
                                  <>
                                    {msg.message_type === "image"
                                      ? `Mensaje con imagen${msg.content ? `\n${msg.content}` : ""}`
                                      : msg.content || "—"}
                                  </>
                                );
                              })()}
                            </div>
                            <p className="text-[10px] opacity-80 mt-1">
                              {fmtDate(msg.created_at)} · {msg.message_type}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
                {detail.conversations.length === 0 && (
                  <div className="text-sm text-slate-500">No hay conversaciones en el rango/filtro seleccionado.</div>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {selectedSummary && (
        <p className="text-xs text-slate-500">
          Contacto activo: {selectedSummary.name || selectedSummary.phone} · último mensaje {fmtDate(selectedSummary.last_message_at)}
        </p>
      )}
    </div>
  );
}
