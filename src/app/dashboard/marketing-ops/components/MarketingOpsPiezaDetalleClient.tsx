"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import type { MarketingOpsComentario, MarketingOpsHistorial, MarketingOpsPieza } from "@/lib/marketing-ops/types";
import {
  ESTADO_CLIENTE_OPTIONS,
  ESTADO_PRODUCCION_OPTIONS,
  ESTADO_PUBLICACION_OPTIONS,
  PRIORIDAD_OPTIONS,
  clienteLabel,
  estadoBadgeClass,
  fmtDate,
  labelFor,
  prioridadBadgeClass,
} from "./marketingOpsUi";

export default function MarketingOpsPiezaDetalleClient({ piezaId }: { piezaId: string }) {
  const [pieza, setPieza] = useState<MarketingOpsPieza | null>(null);
  const [comentarios, setComentarios] = useState<MarketingOpsComentario[]>([]);
  const [historial, setHistorial] = useState<MarketingOpsHistorial[]>([]);
  const [comentario, setComentario] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const res = await fetchWithSupabaseSession(`/api/marketing-ops/piezas/${piezaId}`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      setErr(typeof json.error === "string" ? json.error : "No se pudo cargar la pieza");
      setLoading(false);
      return;
    }
    const data = json.data as {
      pieza: MarketingOpsPieza;
      comentarios: MarketingOpsComentario[];
      historial: MarketingOpsHistorial[];
    };
    setPieza(data.pieza);
    setComentarios(data.comentarios ?? []);
    setHistorial(data.historial ?? []);
    setLoading(false);
  }, [piezaId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function cambiarEstado(campo: "estado_produccion" | "estado_cliente" | "estado_publicacion", estado: string) {
    setSaving(true);
    const res = await fetchWithSupabaseSession(`/api/marketing-ops/piezas/${piezaId}/cambiar-estado`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campo, estado }),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok || !json.success) {
      setErr(typeof json.error === "string" ? json.error : "No se pudo cambiar estado");
      return;
    }
    await load();
  }

  async function agregarComentario(e: React.FormEvent) {
    e.preventDefault();
    if (!comentario.trim()) return;
    setSaving(true);
    const res = await fetchWithSupabaseSession(`/api/marketing-ops/piezas/${piezaId}/comentarios`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comentario }),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok || !json.success) {
      setErr(typeof json.error === "string" ? json.error : "No se pudo comentar");
      return;
    }
    setComentario("");
    await load();
  }

  if (loading && !pieza) {
    return <div className="p-6 text-sm text-slate-500">Cargando pieza...</div>;
  }

  if (!pieza) {
    return (
      <div className="p-6">
        <Link href="/dashboard/marketing-ops" className="text-sm text-sky-700 hover:underline">← Volver</Link>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {err ?? "Pieza no encontrada"}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <Link href="/dashboard/marketing-ops" className="text-sm font-medium text-sky-700 hover:underline">← Marketing Ops</Link>

      {err ? <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{err}</div> : null}

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-3 flex flex-wrap gap-2">
              <Badge className={prioridadBadgeClass(pieza.prioridad)}>{labelFor(PRIORIDAD_OPTIONS, pieza.prioridad)}</Badge>
              <Badge className={estadoBadgeClass(pieza.estado_produccion)}>{labelFor(ESTADO_PRODUCCION_OPTIONS, pieza.estado_produccion)}</Badge>
              <Badge className={estadoBadgeClass(pieza.estado_cliente)}>{labelFor(ESTADO_CLIENTE_OPTIONS, pieza.estado_cliente)}</Badge>
              <Badge className={estadoBadgeClass(pieza.estado_publicacion)}>{labelFor(ESTADO_PUBLICACION_OPTIONS, pieza.estado_publicacion)}</Badge>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">{pieza.titulo}</h1>
            <p className="mt-1 text-sm text-slate-500">{clienteLabel(pieza.cliente)} · {pieza.responsable?.nombre ?? pieza.responsable?.email ?? "Sin responsable"}</p>
          </div>
          {pieza.link_archivo ? (
            <a href={pieza.link_archivo} target="_blank" rel="noreferrer" className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Abrir archivo
            </a>
          ) : null}
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-4">
          <Info label="Tipo" value={pieza.tipo_pieza ?? "—"} />
          <Info label="Canal" value={pieza.canal ?? "—"} />
          <Info label="Fecha límite" value={fmtDate(pieza.fecha_limite)} />
          <Info label="Fecha publicación" value={fmtDate(pieza.fecha_publicacion)} />
        </div>

        {pieza.observaciones ? (
          <div className="mt-6 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
            <p className="mb-1 font-semibold text-slate-900">Observaciones</p>
            <p className="whitespace-pre-wrap">{pieza.observaciones}</p>
          </div>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Cambiar estados</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <EstadoSelect
              label="Producción"
              value={pieza.estado_produccion}
              options={ESTADO_PRODUCCION_OPTIONS}
              disabled={saving}
              onChange={(v) => void cambiarEstado("estado_produccion", v)}
            />
            <EstadoSelect
              label="Cliente"
              value={pieza.estado_cliente}
              options={ESTADO_CLIENTE_OPTIONS}
              disabled={saving}
              onChange={(v) => void cambiarEstado("estado_cliente", v)}
            />
            <EstadoSelect
              label="Publicación"
              value={pieza.estado_publicacion}
              options={ESTADO_PUBLICACION_OPTIONS}
              disabled={saving}
              onChange={(v) => void cambiarEstado("estado_publicacion", v)}
            />
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Comentarios</h2>
          <form onSubmit={agregarComentario} className="mt-4 space-y-2">
            <textarea
              className="min-h-[90px] w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              placeholder="Agregar comentario interno..."
            />
            <button disabled={saving} className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              Comentar
            </button>
          </form>
          <div className="mt-4 space-y-3">
            {comentarios.length === 0 ? <p className="text-sm text-slate-500">Sin comentarios.</p> : null}
            {comentarios.map((c) => (
              <div key={c.id} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                <p className="text-xs text-slate-500">{c.usuario_nombre ?? "Usuario"} · {new Date(c.created_at).toLocaleString()}</p>
                <p className="mt-1 whitespace-pre-wrap text-slate-800">{c.comentario}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Historial de estados</h2>
        <div className="mt-4 space-y-2">
          {historial.length === 0 ? <p className="text-sm text-slate-500">Sin cambios registrados todavía.</p> : null}
          {historial.map((h) => (
            <div key={h.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2 text-sm">
              <span className="font-medium text-slate-800">{h.campo}</span>
              <span className="text-slate-600">{h.estado_anterior ?? "—"} → {h.estado_nuevo ?? "—"}</span>
              <span className="text-xs text-slate-500">{h.usuario_nombre ?? "Usuario"} · {new Date(h.changed_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${className}`}>{children}</span>;
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-900">{value}</p>
    </div>
  );
}

function EstadoSelect({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      <select
        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
