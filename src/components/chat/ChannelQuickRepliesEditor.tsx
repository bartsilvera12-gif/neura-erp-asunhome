"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createChannelQuickReply,
  deleteChannelQuickReply,
  listAllQuickRepliesForChannel,
  updateChannelQuickReply,
  type ChannelQuickReplyRow,
} from "@/lib/chat/quick-replies-actions";

type Props = {
  channelId: string;
  /** Sección padre desactivada (interruptor global del canal). */
  disabled?: boolean;
  /** Sin párrafo inicial: el título/descripción va en ConfigCollapsibleSection. */
  hideIntro?: boolean;
};

export function ChannelQuickRepliesEditor({ channelId, disabled = false, hideIntro = false }: Props) {
  const [rows, setRows] = useState<ChannelQuickReplyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftOrder, setDraftOrder] = useState("0");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!channelId) return;
    setError(null);
    setLoading(true);
    try {
      const r = await listAllQuickRepliesForChannel(channelId);
      setRows(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar las respuestas rápidas");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const title = draftTitle.trim();
    const body = draftBody.trim();
    if (!title || !body) return;
    setCreating(true);
    setError(null);
    try {
      await createChannelQuickReply({
        channelId,
        title,
        body,
        sortOrder: Number.parseInt(draftOrder, 10) || 0,
      });
      setDraftTitle("");
      setDraftBody("");
      setDraftOrder("0");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className={`space-y-5 ${disabled ? "opacity-[0.88]" : ""}`}>
      {!hideIntro ? (
        <p className="text-sm text-slate-600 leading-relaxed">
          Textos reutilizables para el inbox. Los asesores los insertan desde el chat (icono de respuesta rápida). Solo
          se listan las <span className="font-semibold">activas</span> en la bandeja.
        </p>
      ) : null}

      {disabled ? (
        <p className="text-xs text-amber-900/90 bg-amber-50 border border-amber-200/80 rounded-lg px-3 py-2">
          Activá esta sección con el interruptor superior para editar plantillas y que aparezcan en el inbox.
        </p>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      ) : null}

      <form
        onSubmit={(e) => void handleCreate(e)}
        className="rounded-lg border border-slate-200 bg-white p-4 space-y-4"
      >
        <h4 className="text-sm font-semibold text-slate-800">Nueva respuesta rápida</h4>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Nombre interno</label>
            <input
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder="Ej: Saludo inicial"
              maxLength={120}
              disabled={disabled}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Orden</label>
            <input
              type="number"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm tabular-nums"
              value={draftOrder}
              onChange={(e) => setDraftOrder(e.target.value)}
              min={0}
              disabled={disabled}
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Texto completo</label>
          <textarea
            className="w-full min-h-[88px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm resize-y"
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            placeholder="Mensaje que se insertará en el campo de escritura…"
            disabled={disabled}
          />
        </div>
        <div className="flex justify-end pt-1">
          <button
            type="submit"
            disabled={disabled || creating || !draftTitle.trim() || !draftBody.trim()}
            className="rounded-lg bg-[#0EA5E9] hover:bg-[#0284C7] disabled:opacity-50 text-white px-5 py-2 text-sm font-medium"
          >
            {creating ? "Guardando…" : "Agregar"}
          </button>
        </div>
      </form>

      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="bg-slate-50/90 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Respuestas definidas</span>
          <button
            type="button"
            onClick={() => void load()}
            className="text-xs font-semibold text-[#0EA5E9] hover:underline disabled:opacity-50"
            disabled={loading || disabled}
          >
            Actualizar
          </button>
        </div>
        {loading ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">Cargando…</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">No hay respuestas rápidas aún.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <QuickReplyRowEditor
                key={r.id}
                row={r}
                disabled={disabled || savingId !== null}
                onBusy={(id) => setSavingId(id)}
                onReload={() => void load()}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function QuickReplyRowEditor({
  row,
  disabled,
  onBusy,
  onReload,
}: {
  row: ChannelQuickReplyRow;
  disabled: boolean;
  onBusy: (id: string | null) => void;
  onReload: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState(row.title);
  const [body, setBody] = useState(row.body);
  const [sortOrder, setSortOrder] = useState(String(row.sort_order));
  const [active, setActive] = useState(row.is_active);

  useEffect(() => {
    setTitle(row.title);
    setBody(row.body);
    setSortOrder(String(row.sort_order));
    setActive(row.is_active);
  }, [row]);

  async function saveField() {
    onBusy(row.id);
    try {
      await updateChannelQuickReply({
        id: row.id,
        title: title.trim(),
        body: body.trim(),
        sortOrder: Number.parseInt(sortOrder, 10) || 0,
        isActive: active,
      });
      onReload();
    } finally {
      onBusy(null);
    }
  }

  async function toggleActive(next: boolean) {
    setActive(next);
    onBusy(row.id);
    try {
      await updateChannelQuickReply({ id: row.id, isActive: next });
      onReload();
    } catch {
      setActive(!next);
    } finally {
      onBusy(null);
    }
  }

  async function remove() {
    if (!confirm("¿Eliminar esta respuesta rápida?")) return;
    onBusy(row.id);
    try {
      await deleteChannelQuickReply(row.id);
      onReload();
    } finally {
      onBusy(null);
    }
  }

  return (
    <li className="bg-white px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            className="text-left w-full font-semibold text-slate-900 text-sm truncate hover:text-sky-700"
            onClick={() => setExpanded((x) => !x)}
          >
            {row.title}{" "}
            <span className="font-normal text-slate-400 text-xs ml-1">#{row.sort_order}</span>
            {!row.is_active ? (
              <span className="ml-2 text-[10px] font-bold uppercase text-amber-800 bg-amber-50 border border-amber-200 rounded px-1">
                Inactiva
              </span>
            ) : null}
          </button>
          {!expanded ? (
            <p className="text-xs text-slate-500 line-clamp-2 mt-0.5">{row.body}</p>
          ) : null}
        </div>
        <label className="flex items-center gap-2 shrink-0 text-xs text-slate-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={active}
            disabled={disabled}
            onChange={(e) => void toggleActive(e.target.checked)}
          />
          Activa
        </label>
      </div>

      {expanded ? (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={disabled}
          />
          <textarea
            className="w-full min-h-[72px] rounded-lg border border-slate-200 px-3 py-2 text-sm resize-y"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={disabled}
          />
          <div className="flex flex-wrap gap-2 items-center">
            <label className="text-[11px] text-slate-500 flex items-center gap-1">
              Orden
              <input
                type="number"
                className="w-20 rounded border border-slate-200 px-2 py-1 text-sm tabular-nums"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                disabled={disabled}
                min={0}
              />
            </label>
            <button
              type="button"
              disabled={disabled}
              onClick={() => void saveField()}
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
            >
              Guardar cambios
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => void remove()}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 ml-auto"
            >
              Eliminar
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
