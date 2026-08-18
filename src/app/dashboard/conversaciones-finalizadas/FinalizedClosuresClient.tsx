"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import {
  listFinalizedClosures,
  type FinalizedClosureListRow,
  type FinalizedClosuresFilters,
  type FinalizedFilterOptions,
} from "@/lib/chat/finalized-closures-actions";

const PAGE_SIZE = 25;
const EXPORT_MAX_ROWS = 5000;

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeCsvCell(value: string): string {
  const s = String(value).replace(/"/g, '""');
  if (/[",\n\r]/.test(s)) return `"${s}"`;
  return s;
}

function buildCsv(rows: FinalizedClosureListRow[]): string {
  const headers = [
    "ID cierre",
    "ID conversación",
    "Fecha de finalización",
    "Contacto",
    "Número",
    "Canal (tipo)",
    "Canal (nombre)",
    "Cola",
    "Agente asignado",
    "Cerrado por",
    "Estado",
    "Subestado",
    "Comentario de cierre",
    "Último mensaje / resumen",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    const canalTipo = r.channel_type;
    const canalNombre = r.channel_nombre ?? "";
    lines.push(
      [
        escapeCsvCell(r.closure_id),
        escapeCsvCell(r.conversation_id),
        escapeCsvCell(formatDateTime(r.closed_at)),
        escapeCsvCell(r.contact_name ?? ""),
        escapeCsvCell(r.phone_number),
        escapeCsvCell(canalTipo),
        escapeCsvCell(canalNombre),
        escapeCsvCell(r.queue_nombre ?? ""),
        escapeCsvCell(r.assigned_agent_nombre ?? ""),
        escapeCsvCell(r.closed_by_nombre ?? ""),
        escapeCsvCell(r.state_label),
        escapeCsvCell(r.substate_label),
        escapeCsvCell(r.comment ?? ""),
        escapeCsvCell(r.last_preview ?? ""),
      ].join(",")
    );
  }
  return lines.join("\r\n");
}

type ChatMessageRow = {
  id: string;
  from_me: boolean;
  message_type: string;
  content: string | null;
  created_at: string;
};

export default function FinalizedClosuresClient({ filterOptions }: { filterOptions: FinalizedFilterOptions }) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [queueId, setQueueId] = useState("");
  const [assignedUsuarioId, setAssignedUsuarioId] = useState("");
  const [closedByUsuarioId, setClosedByUsuarioId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [stateLabel, setStateLabel] = useState("");
  const [substateLabel, setSubstateLabel] = useState("");
  const [q, setQ] = useState("");

  const [applied, setApplied] = useState<FinalizedClosuresFilters>({});

  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<FinalizedClosureListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [detail, setDetail] = useState<FinalizedClosureListRow | null>(null);
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [msgError, setMsgError] = useState<string | null>(null);

  const filtersPayload = useMemo((): FinalizedClosuresFilters => {
    const f: FinalizedClosuresFilters = {};
    if (applied.date_from?.trim()) f.date_from = applied.date_from.trim();
    if (applied.date_to?.trim()) f.date_to = applied.date_to.trim();
    if (applied.queue_id?.trim()) f.queue_id = applied.queue_id.trim();
    if (applied.assigned_usuario_id?.trim()) f.assigned_usuario_id = applied.assigned_usuario_id.trim();
    if (applied.closed_by_usuario_id?.trim()) f.closed_by_usuario_id = applied.closed_by_usuario_id.trim();
    if (applied.channel_id?.trim()) f.channel_id = applied.channel_id.trim();
    if (applied.state_label?.trim()) f.state_label = applied.state_label.trim();
    if (applied.substate_label?.trim()) f.substate_label = applied.substate_label.trim();
    if (applied.q?.trim()) f.q = applied.q.trim();
    return f;
  }, [applied]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const res = await listFinalizedClosures(filtersPayload, page, PAGE_SIZE);
      setRows(res.rows);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar");
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [filtersPayload, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const applyFilters = () => {
    setInfo(null);
    setApplied({
      date_from: dateFrom || null,
      date_to: dateTo || null,
      queue_id: queueId || null,
      assigned_usuario_id: assignedUsuarioId || null,
      closed_by_usuario_id: closedByUsuarioId || null,
      channel_id: channelId || null,
      state_label: stateLabel || null,
      substate_label: substateLabel || null,
      q: q || null,
    });
    setPage(1);
  };

  const onExport = async () => {
    setError(null);
    setInfo(null);
    try {
      const res = await listFinalizedClosures(filtersPayload, 1, EXPORT_MAX_ROWS);
      const csv = buildCsv(res.rows);
      const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `conversaciones-finalizadas-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      if (res.total > res.rows.length) {
        setInfo(
          `Se exportaron ${res.rows.length} filas de ${res.total} (límite ${EXPORT_MAX_ROWS}). Ajustá filtros o fechas para acotar el conjunto.`
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al exportar");
    }
  };

  useEffect(() => {
    if (!detail) {
      setMessages([]);
      setMsgError(null);
      return;
    }
    const cid = detail.conversation_id;
    let cancelled = false;
    setMsgLoading(true);
    setMsgError(null);
    setMessages([]);
    void (async () => {
      try {
        const res = await fetchWithSupabaseSession(
          `/api/chat/messages?conversation_id=${encodeURIComponent(cid)}`,
          { cache: "no-store" }
        );
        const json = (await res.json()) as {
          success?: boolean;
          data?: ChatMessageRow[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !json.success) {
          setMsgError(json.error ?? "No se pudieron cargar los mensajes");
          return;
        }
        setMessages(Array.isArray(json.data) ? json.data : []);
      } catch {
        if (!cancelled) setMsgError("Error de red al cargar mensajes");
      } finally {
        if (!cancelled) setMsgLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detail]);

  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetail(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const channelLabel = (r: FinalizedClosureListRow) =>
    r.channel_nombre?.trim() ? `${r.channel_nombre} (${r.channel_type})` : r.channel_type;

  return (
    <div className="flex flex-col gap-6 pb-12 px-4 md:px-6 max-w-[1400px] mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4 pt-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Conversaciones finalizadas</h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            {filterOptions.ux_scope === "team"
              ? "Vista acotada a tu alcance omnicanal: los combos solo listan colas, agentes y canales relevantes para tu equipo. Exportá el resultado filtrado."
              : "Bandeja global de cierres: todas las colas, agentes y canales. Filtrá, revisá el detalle sin salir de la pantalla y exportá el resultado filtrado para Excel."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onExport()}
          disabled={loading}
          className="inline-flex items-center rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
        >
          Descargar Excel (CSV)
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}
      {info && !error && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">{info}</div>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5 shadow-sm space-y-4">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Filtros</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Desde
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Hasta
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Cola
            <select
              value={queueId}
              onChange={(e) => setQueueId(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 bg-white"
            >
              <option value="">Todas</option>
              {filterOptions.queues.map((qItem) => (
                <option key={qItem.id} value={qItem.id}>
                  {qItem.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Agente asignado
            <select
              value={assignedUsuarioId}
              onChange={(e) => setAssignedUsuarioId(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 bg-white"
            >
              <option value="">Todos</option>
              {filterOptions.agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Canal
            <select
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 bg-white"
            >
              <option value="">Todos</option>
              {filterOptions.channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {(c.nombre ?? c.type).trim() || c.type}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Estado
            <select
              value={stateLabel}
              onChange={(e) => setStateLabel(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 bg-white"
            >
              <option value="">Todos</option>
              {filterOptions.state_labels.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Subestado
            <select
              value={substateLabel}
              onChange={(e) => setSubstateLabel(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 bg-white"
            >
              <option value="">Todos</option>
              {filterOptions.substate_labels.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 sm:col-span-2">
            Nombre o número
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar contacto…"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
            />
          </label>
        </div>

        <details className="rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700 select-none">
            Filtros secundarios
          </summary>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Cerrado por
              <select
                value={closedByUsuarioId}
                onChange={(e) => setClosedByUsuarioId(e.target.value)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 bg-white"
              >
                <option value="">Todos</option>
                {(filterOptions.closed_by_users ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs text-slate-500 sm:col-span-2 self-end pb-1">
              Usuarios que aparecen en cierres recientes (muestra). Para auditoría puntual del cierre, no del agente
              asignado.
            </p>
          </div>
        </details>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={applyFilters}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Aplicar filtros
          </button>
          <button
            type="button"
            onClick={() => {
              setDateFrom("");
              setDateTo("");
              setQueueId("");
              setAssignedUsuarioId("");
              setClosedByUsuarioId("");
              setChannelId("");
              setStateLabel("");
              setSubstateLabel("");
              setQ("");
              setInfo(null);
              setError(null);
              setApplied({});
              setPage(1);
            }}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Limpiar
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-[1000px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-3 py-3 whitespace-nowrap">Finalización</th>
                <th className="px-3 py-3">Contacto</th>
                <th className="px-3 py-3 whitespace-nowrap">Número</th>
                <th className="px-3 py-3">Canal</th>
                <th className="px-3 py-3">Cola</th>
                <th className="px-3 py-3">Agente asignado</th>
                <th className="px-3 py-3">Cerrado por</th>
                <th className="px-3 py-3">Estado</th>
                <th className="px-3 py-3">Subestado</th>
                <th className="px-3 py-3 min-w-[140px]">Comentario</th>
                <th className="px-3 py-3 min-w-[160px]">Último mensaje</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={11} className="px-3 py-10 text-center text-slate-400">
                    Cargando…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-3 py-10 text-center text-slate-500">
                    No hay conversaciones finalizadas con estos filtros.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.closure_id}
                    onClick={() => setDetail(r)}
                    className="cursor-pointer hover:bg-slate-50/80 transition-colors"
                  >
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-700">{formatDateTime(r.closed_at)}</td>
                    <td className="px-3 py-2.5 text-slate-900 font-medium">{r.contact_name ?? "—"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-600">{r.phone_number}</td>
                    <td className="px-3 py-2.5 text-slate-700">{channelLabel(r)}</td>
                    <td className="px-3 py-2.5 text-slate-700">{r.queue_nombre ?? "—"}</td>
                    <td className="px-3 py-2.5 text-slate-700">{r.assigned_agent_nombre ?? "—"}</td>
                    <td className="px-3 py-2.5 text-slate-700">{r.closed_by_nombre ?? "—"}</td>
                    <td className="px-3 py-2.5 text-slate-700">{r.state_label}</td>
                    <td className="px-3 py-2.5 text-slate-700">{r.substate_label}</td>
                    <td className="px-3 py-2.5 text-slate-600 max-w-[200px] truncate" title={r.comment}>
                      {r.comment || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 max-w-[220px] truncate" title={r.last_preview ?? ""}>
                      {r.last_preview ?? "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!loading && total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
            <span>
              {total === 0 ? "0" : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)}`} de {total}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-slate-200 px-3 py-1.5 font-medium disabled:opacity-40 hover:bg-slate-50"
              >
                Anterior
              </button>
              <span className="self-center text-slate-500">
                Página {page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 font-medium disabled:opacity-40 hover:bg-slate-50"
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </section>

      {detail && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-labelledby="finalized-detail-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDetail(null);
          }}
        >
          <div
            className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-xl border border-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 shrink-0">
              <div>
                <h2 id="finalized-detail-title" className="text-lg font-bold text-slate-900">
                  Detalle del cierre
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">Conversación {detail.conversation_id}</p>
              </div>
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                aria-label="Cerrar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4 text-sm">
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                <div>
                  <dt className="text-xs font-semibold text-slate-500">Contacto</dt>
                  <dd className="text-slate-900">{detail.contact_name ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-slate-500">Número</dt>
                  <dd className="text-slate-900">{detail.phone_number}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-slate-500">Fecha de cierre</dt>
                  <dd className="text-slate-900">{formatDateTime(detail.closed_at)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-slate-500">Agente asignado</dt>
                  <dd className="text-slate-900">{detail.assigned_agent_nombre ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-slate-500">Cerrado por</dt>
                  <dd className="text-slate-900">{detail.closed_by_nombre ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-slate-500">Cola</dt>
                  <dd className="text-slate-900">{detail.queue_nombre ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-slate-500">Canal</dt>
                  <dd className="text-slate-900">{channelLabel(detail)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-slate-500">Estado</dt>
                  <dd className="text-slate-900">{detail.state_label}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-slate-500">Subestado</dt>
                  <dd className="text-slate-900">{detail.substate_label}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-semibold text-slate-500">Comentario</dt>
                  <dd className="text-slate-800 whitespace-pre-wrap mt-1">{detail.comment || "—"}</dd>
                </div>
              </dl>

              <div>
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Mensajes</h3>
                {msgLoading ? (
                  <p className="text-slate-400 text-sm">Cargando historial…</p>
                ) : msgError ? (
                  <p className="text-red-600 text-sm">{msgError}</p>
                ) : messages.length === 0 ? (
                  <p className="text-slate-500 text-sm">No hay mensajes en esta conversación.</p>
                ) : (
                  <ul className="space-y-2 max-h-[min(50vh,420px)] overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/50 p-3">
                    {messages.map((m) => (
                      <li
                        key={m.id}
                        className={`rounded-lg px-3 py-2 text-sm border ${
                          m.from_me
                            ? "border-sky-200 bg-sky-50 text-slate-800 ml-4"
                            : "border-slate-200 bg-white text-slate-800 mr-4"
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 mb-1">
                          <span>{formatDateTime(m.created_at)}</span>
                          <span className="rounded bg-slate-200/80 px-1.5 py-0.5 text-slate-700">{m.message_type}</span>
                          <span>{m.from_me ? "Saliente" : "Entrante"}</span>
                        </div>
                        <p className="whitespace-pre-wrap break-words">{m.content ?? "—"}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="border-t border-slate-100 px-5 py-3 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
