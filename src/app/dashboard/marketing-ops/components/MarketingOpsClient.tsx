"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchWithSupabaseSession, isAbortError } from "@/lib/api/fetch-with-supabase-session";
import type { MarketingOpsDashboard, MarketingOpsPieza } from "@/lib/marketing-ops/types";
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

type ClienteOption = { id: string; empresa?: string | null; nombre_contacto?: string | null; nombre?: string | null };
type UsuarioOption = { id: string; nombre?: string | null; email?: string | null };

type PiezaDraft = {
  id?: string;
  titulo: string;
  cliente_id: string;
  tipo_pieza: string;
  canal: string;
  responsable_id: string;
  fecha_limite: string;
  fecha_publicacion: string;
  prioridad: string;
  estado_produccion: string;
  estado_cliente: string;
  estado_publicacion: string;
  link_archivo: string;
  observaciones: string;
};

const EMPTY_DRAFT: PiezaDraft = {
  titulo: "",
  cliente_id: "",
  tipo_pieza: "",
  canal: "",
  responsable_id: "",
  fecha_limite: "",
  fecha_publicacion: "",
  prioridad: "media",
  estado_produccion: "por_hacer",
  estado_cliente: "no_enviado",
  estado_publicacion: "pendiente",
  link_archivo: "",
  observaciones: "",
};

function draftFromPieza(p: MarketingOpsPieza): PiezaDraft {
  return {
    id: p.id,
    titulo: p.titulo,
    cliente_id: p.cliente_id ?? "",
    tipo_pieza: p.tipo_pieza ?? "",
    canal: p.canal ?? "",
    responsable_id: p.responsable_id ?? "",
    fecha_limite: p.fecha_limite ?? "",
    fecha_publicacion: p.fecha_publicacion ?? "",
    prioridad: p.prioridad,
    estado_produccion: p.estado_produccion,
    estado_cliente: p.estado_cliente,
    estado_publicacion: p.estado_publicacion,
    link_archivo: p.link_archivo ?? "",
    observaciones: p.observaciones ?? "",
  };
}

export default function MarketingOpsClient() {
  const [dashboard, setDashboard] = useState<MarketingOpsDashboard | null>(null);
  const [piezas, setPiezas] = useState<MarketingOpsPieza[]>([]);
  const [clientes, setClientes] = useState<ClienteOption[]>([]);
  const [usuarios, setUsuarios] = useState<UsuarioOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<PiezaDraft | null>(null);

  const [filters, setFilters] = useState({
    q: "",
    cliente_id: "",
    responsable_id: "",
    prioridad: "",
    estado_produccion: "",
    estado_cliente: "",
    estado_publicacion: "",
    vencidas: false,
  });

  const query = useMemo(() => {
    const sp = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (typeof value === "boolean") {
        if (value) sp.set(key, "true");
      } else if (value.trim()) {
        sp.set(key, value.trim());
      }
    }
    return sp.toString();
  }, [filters]);

  // signal opcional: el useEffect le pasa uno para abortar si la pagina se desmonta;
  // los handlers (saveDraft, boton de refresh) llaman load() sin signal porque
  // arrancan con el componente seguro montado.
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setErr(null);
    try {
      const [rDash, rPiezas, rClientes, rUsers] = await Promise.all([
        fetchWithSupabaseSession("/api/marketing-ops/dashboard", { cache: "no-store", signal }),
        fetchWithSupabaseSession(`/api/marketing-ops/piezas${query ? `?${query}` : ""}`, { cache: "no-store", signal }),
        fetchWithSupabaseSession("/api/clientes", { cache: "no-store", signal }),
        fetchWithSupabaseSession("/api/usuarios/empresa-activos", { cache: "no-store", signal }),
      ]);

      if (signal?.aborted) return;

      const [jDash, jPiezas, jClientes, jUsers] = await Promise.all([
        rDash.json().catch(() => ({})),
        rPiezas.json().catch(() => ({})),
        rClientes.json().catch(() => ({})),
        rUsers.json().catch(() => ({})),
      ]);

      if (signal?.aborted) return;

      if (!rDash.ok || !jDash.success) {
        setErr(typeof jDash.error === "string" ? jDash.error : "No se pudo cargar Marketing Ops");
        setLoading(false);
        return;
      }
      if (!rPiezas.ok || !jPiezas.success) {
        setErr(typeof jPiezas.error === "string" ? jPiezas.error : "No se pudieron cargar piezas");
        setLoading(false);
        return;
      }

      setDashboard(jDash.data as MarketingOpsDashboard);
      setPiezas(Array.isArray(jPiezas.data) ? (jPiezas.data as MarketingOpsPieza[]) : []);
      setClientes(Array.isArray(jClientes.data) ? (jClientes.data as ClienteOption[]) : []);
      setUsuarios(Array.isArray(jUsers.usuarios) ? (jUsers.usuarios as UsuarioOption[]) : []);
      setLoading(false);
    } catch (e) {
      if (isAbortError(e)) return;
      setErr(e instanceof Error ? e.message : "Error al cargar Marketing Ops");
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  async function saveDraft() {
    if (!draft) return;
    setSaving(true);
    setErr(null);
    const isEdit = Boolean(draft.id);
    const payload = {
      titulo: draft.titulo,
      cliente_id: draft.cliente_id || null,
      tipo_pieza: draft.tipo_pieza || null,
      canal: draft.canal || null,
      responsable_id: draft.responsable_id || null,
      fecha_limite: draft.fecha_limite || null,
      fecha_publicacion: draft.fecha_publicacion || null,
      prioridad: draft.prioridad,
      estado_produccion: draft.estado_produccion,
      estado_cliente: draft.estado_cliente,
      estado_publicacion: draft.estado_publicacion,
      link_archivo: draft.link_archivo || null,
      observaciones: draft.observaciones || null,
    };
    const res = await fetchWithSupabaseSession(
      isEdit ? `/api/marketing-ops/piezas/${draft.id}` : "/api/marketing-ops/piezas",
      {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok || !json.success) {
      setErr(typeof json.error === "string" ? json.error : "No se pudo guardar");
      return;
    }
    setDraft(null);
    await load();
  }

  const kpis = [
    ["Piezas pendientes", dashboard?.pendientes ?? 0],
    ["Vencidas", dashboard?.vencidas ?? 0],
    ["En producción", dashboard?.en_produccion ?? 0],
    ["En revisión", dashboard?.en_revision ?? 0],
    ["Enviadas al cliente", dashboard?.enviadas_cliente ?? 0],
    ["Aprobadas", dashboard?.aprobadas ?? 0],
    ["Programadas", dashboard?.programadas ?? 0],
    ["Publicadas", dashboard?.publicadas ?? 0],
  ];

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Marketing Ops</h1>
          <p className="mt-1 text-sm text-slate-500">
            Operación de piezas por cliente, responsable, prioridad, aprobación y publicación.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDraft({ ...EMPTY_DRAFT })}
          className="rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-sky-700"
        >
          Nueva pieza
        </button>
      </div>

      {err ? <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{err}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        {kpis.map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950 tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-2 md:grid-cols-4 xl:grid-cols-8">
          <input
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm md:col-span-2"
            placeholder="Buscar título..."
            value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
          />
          <FilterSelect label="Cliente" value={filters.cliente_id} onChange={(v) => setFilters((f) => ({ ...f, cliente_id: v }))}>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {clienteLabel(c)}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Responsable" value={filters.responsable_id} onChange={(v) => setFilters((f) => ({ ...f, responsable_id: v }))}>
            {usuarios.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre || u.email || u.id.slice(0, 8)}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Prioridad" value={filters.prioridad} onChange={(v) => setFilters((f) => ({ ...f, prioridad: v }))}>
            {PRIORIDAD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Producción" value={filters.estado_produccion} onChange={(v) => setFilters((f) => ({ ...f, estado_produccion: v }))}>
            {ESTADO_PRODUCCION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Cliente" value={filters.estado_cliente} onChange={(v) => setFilters((f) => ({ ...f, estado_cliente: v }))}>
            {ESTADO_CLIENTE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Publicación" value={filters.estado_publicacion} onChange={(v) => setFilters((f) => ({ ...f, estado_publicacion: v }))}>
            {ESTADO_PUBLICACION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </FilterSelect>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={filters.vencidas}
              onChange={(e) => setFilters((f) => ({ ...f, vencidas: e.target.checked }))}
            />
            Solo vencidas
          </label>
          <button type="button" onClick={() => void load()} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white">
            Aplicar filtros
          </button>
          <button type="button" onClick={() => setFilters({ q: "", cliente_id: "", responsable_id: "", prioridad: "", estado_produccion: "", estado_cliente: "", estado_publicacion: "", vencidas: false })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Limpiar
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {/* min-w-[1200px] activa scroll horizontal en mobile (10 columnas).
            Antes min-w-full hacia que la tabla se encogiera y los botones
            "Editar"/"Detalle" quedaran cortados. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px] xl:min-w-0 divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Título</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Responsable</th>
                <th className="px-4 py-3">Prioridad</th>
                <th className="px-4 py-3">Producción</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Publicación</th>
                <th className="px-4 py-3">Límite</th>
                <th className="px-4 py-3">Publicar</th>
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-slate-500">Cargando...</td></tr>
              ) : piezas.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-slate-500">Sin piezas para los filtros actuales.</td></tr>
              ) : (
                piezas.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/70">
                    <td className="max-w-[280px] px-4 py-3">
                      <p className="font-semibold text-slate-950">{p.titulo}</p>
                      <p className="text-xs text-slate-500">{[p.tipo_pieza, p.canal].filter(Boolean).join(" · ") || "—"}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{clienteLabel(p.cliente)}</td>
                    <td className="px-4 py-3 text-slate-700">{p.responsable?.nombre ?? p.responsable?.email ?? "—"}</td>
                    <td className="px-4 py-3"><Badge className={prioridadBadgeClass(p.prioridad)}>{labelFor(PRIORIDAD_OPTIONS, p.prioridad)}</Badge></td>
                    <td className="px-4 py-3"><Badge className={estadoBadgeClass(p.estado_produccion)}>{labelFor(ESTADO_PRODUCCION_OPTIONS, p.estado_produccion)}</Badge></td>
                    <td className="px-4 py-3"><Badge className={estadoBadgeClass(p.estado_cliente)}>{labelFor(ESTADO_CLIENTE_OPTIONS, p.estado_cliente)}</Badge></td>
                    <td className="px-4 py-3"><Badge className={estadoBadgeClass(p.estado_publicacion)}>{labelFor(ESTADO_PUBLICACION_OPTIONS, p.estado_publicacion)}</Badge></td>
                    <td className="px-4 py-3 text-slate-700">{fmtDate(p.fecha_limite)}</td>
                    <td className="px-4 py-3 text-slate-700">{fmtDate(p.fecha_publicacion)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setDraft(draftFromPieza(p))} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                          Editar
                        </button>
                        <Link href={`/dashboard/marketing-ops/piezas/${p.id}`} className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800">
                          Detalle
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {draft ? (
        <PiezaModal
          draft={draft}
          clientes={clientes}
          usuarios={usuarios}
          saving={saving}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onSave={() => void saveDraft()}
        />
      ) : null}
    </div>
  );
}

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${className}`}>{children}</span>;
}

function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">{label}</option>
      {children}
    </select>
  );
}

function PiezaModal({
  draft,
  clientes,
  usuarios,
  saving,
  onChange,
  onClose,
  onSave,
}: {
  draft: PiezaDraft;
  clientes: ClienteOption[];
  usuarios: UsuarioOption[];
  saving: boolean;
  onChange: (draft: PiezaDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const set = (patch: Partial<PiezaDraft>) => onChange({ ...draft, ...patch });
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/50" aria-label="Cerrar" onClick={onClose} />
      <div className="relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">{draft.id ? "Editar pieza" : "Nueva pieza"}</h2>
            <p className="text-sm text-slate-500">Datos operativos de Marketing Ops.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm">Cerrar</button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Título" className="sm:col-span-2">
            <input className="input" value={draft.titulo} onChange={(e) => set({ titulo: e.target.value })} />
          </Field>
          <Field label="Cliente">
            <select className="input" value={draft.cliente_id} onChange={(e) => set({ cliente_id: e.target.value })}>
              <option value="">Sin cliente</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{clienteLabel(c)}</option>)}
            </select>
          </Field>
          <Field label="Responsable">
            <select className="input" value={draft.responsable_id} onChange={(e) => set({ responsable_id: e.target.value })}>
              <option value="">Sin responsable</option>
              {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre || u.email || u.id.slice(0, 8)}</option>)}
            </select>
          </Field>
          <Field label="Tipo de pieza">
            <input className="input" value={draft.tipo_pieza} onChange={(e) => set({ tipo_pieza: e.target.value })} placeholder="Post, reel, historia..." />
          </Field>
          <Field label="Canal">
            <input className="input" value={draft.canal} onChange={(e) => set({ canal: e.target.value })} placeholder="Instagram, Meta Ads..." />
          </Field>
          <Field label="Prioridad">
            <select className="input" value={draft.prioridad} onChange={(e) => set({ prioridad: e.target.value })}>
              {PRIORIDAD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Estado producción">
            <select className="input" value={draft.estado_produccion} onChange={(e) => set({ estado_produccion: e.target.value })}>
              {ESTADO_PRODUCCION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Estado cliente">
            <select className="input" value={draft.estado_cliente} onChange={(e) => set({ estado_cliente: e.target.value })}>
              {ESTADO_CLIENTE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Estado publicación">
            <select className="input" value={draft.estado_publicacion} onChange={(e) => set({ estado_publicacion: e.target.value })}>
              {ESTADO_PUBLICACION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Fecha límite">
            <input type="date" className="input" value={draft.fecha_limite} onChange={(e) => set({ fecha_limite: e.target.value })} />
          </Field>
          <Field label="Fecha publicación">
            <input type="date" className="input" value={draft.fecha_publicacion} onChange={(e) => set({ fecha_publicacion: e.target.value })} />
          </Field>
          <Field label="Link archivo" className="sm:col-span-2">
            <input className="input" value={draft.link_archivo} onChange={(e) => set({ link_archivo: e.target.value })} placeholder="https://..." />
          </Field>
          <Field label="Observaciones" className="sm:col-span-2">
            <textarea className="input min-h-[96px]" value={draft.observaciones} onChange={(e) => set({ observaciones: e.target.value })} />
          </Field>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700">Cancelar</button>
          <button type="button" disabled={saving} onClick={onSave} className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60">
            {saving ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
      <style jsx>{`
        .input {
          width: 100%;
          border-radius: 0.75rem;
          border: 1px solid rgb(226 232 240);
          padding: 0.625rem 0.75rem;
          font-size: 0.875rem;
          outline: none;
        }
        .input:focus {
          border-color: rgb(14 165 233);
          box-shadow: 0 0 0 2px rgb(186 230 253);
        }
      `}</style>
    </div>
  );
}

function Field({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}
