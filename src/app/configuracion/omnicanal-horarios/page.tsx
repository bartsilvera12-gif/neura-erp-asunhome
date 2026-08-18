"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import {
  deleteOmnicanalWorkSchedule,
  listOmnicanalWorkSchedules,
  upsertOmnicanalWorkSchedule,
  type OmnicanalWorkScheduleRow,
} from "@/lib/chat/omnicanal-schedule-actions";
import { CalendarClock, Plus, Trash2 } from "lucide-react";

const DOW: { v: number; l: string }[] = [
  { v: 1, l: "Lun" },
  { v: 2, l: "Mar" },
  { v: 3, l: "Mié" },
  { v: 4, l: "Jue" },
  { v: 5, l: "Vie" },
  { v: 6, l: "Sáb" },
  { v: 7, l: "Dom" },
];

function hasOmnichannelFromModuleAccess(body: { superAdmin?: boolean; slugs?: string[] }): boolean {
  if (body.superAdmin) return true;
  const slugs = Array.isArray(body.slugs) ? body.slugs : [];
  return slugs.includes("conversaciones") || slugs.includes("omnicanal");
}

function fmtDays(days: number[]): string {
  const set = new Set(days.filter((n) => n >= 1 && n <= 7));
  return DOW.filter((d) => set.has(d.v))
    .map((d) => d.l)
    .join(", ");
}

function sliceTime(t: string): string {
  const s = t?.trim() ?? "";
  return s.length >= 5 ? s.slice(0, 5) : s;
}

export default function OmnicanalHorariosPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<OmnicanalWorkScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [draftId, setDraftId] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [timeStart, setTimeStart] = useState("09:00");
  const [timeEnd, setTimeEnd] = useState("18:00");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [activo, setActivo] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listOmnicanalWorkSchedules();
      setRows(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar horarios");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWithSupabaseSession("/api/empresas/module-access", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          setAllowed(false);
          return;
        }
        const body = (await res.json()) as { superAdmin?: boolean; slugs?: string[] };
        setAllowed(hasOmnichannelFromModuleAccess(body));
      })
      .catch(() => setAllowed(false));
  }, []);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  function resetDraft() {
    setDraftId(null);
    setNombre("");
    setTimeStart("09:00");
    setTimeEnd("18:00");
    setDays([1, 2, 3, 4, 5]);
    setActivo(true);
  }

  function editRow(r: OmnicanalWorkScheduleRow) {
    setDraftId(r.id);
    setNombre(r.nombre);
    setTimeStart(sliceTime(r.time_start));
    setTimeEnd(sliceTime(r.time_end));
    setDays(Array.isArray(r.days_of_week) ? [...r.days_of_week] : []);
    setActivo(r.is_active !== false);
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await upsertOmnicanalWorkSchedule({
        id: draftId ?? undefined,
        nombre,
        time_start: `${timeStart}:00`,
        time_end: `${timeEnd}:00`,
        days_of_week: days,
        is_active: activo,
      });
      resetDraft();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  async function eliminar(id: string) {
    if (!confirm("¿Eliminar este horario? Los usuarios que lo usaban quedarán sin turno asignado.")) return;
    setSaving(true);
    try {
      await deleteOmnicanalWorkSchedule(id);
      if (draftId === id) resetDraft();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar");
    } finally {
      setSaving(false);
    }
  }

  function toggleDay(v: number) {
    setDays((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v].sort((a, b) => a - b)));
  }

  if (allowed === false) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <p className="text-sm text-slate-600">
          Tu empresa no tiene activo el módulo omnicanal o no tenés acceso a esta configuración.
        </p>
        <Link href="/configuracion" className="mt-4 inline-block text-sm font-semibold text-[#0EA5E9] hover:underline">
          Volver a configuración global
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 px-4 pb-12 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Horarios de trabajo omnicanal</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Plantillas de franja horaria y días (uso futuro: fuera de turno, métricas dentro del turno). Asignalas a cada
            usuario agente desde{" "}
            <Link href="/usuarios" className="font-semibold text-[#0EA5E9] hover:underline">
              Usuarios
            </Link>
            .
          </p>
        </div>
        <Link
          href="/configuracion"
          className="text-sm font-semibold text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline"
        >
          ← Configuración global
        </Link>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-slate-400" aria-hidden />
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">{draftId ? "Editar" : "Nuevo"} horario</h2>
        </div>
        <form onSubmit={(e) => void guardar(e)} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Nombre</label>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              placeholder="Ej. Turno mañana"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Inicio</label>
            <input
              type="time"
              value={timeStart}
              onChange={(e) => setTimeStart(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Fin</label>
            <input
              type="time"
              value={timeEnd}
              onChange={(e) => setTimeEnd(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
            />
          </div>
          <div className="sm:col-span-2">
            <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Días (ISO 1=Lun … 7=Dom)</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {DOW.map((d) => (
                <button
                  key={d.v}
                  type="button"
                  onClick={() => toggleDay(d.v)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    days.includes(d.v)
                      ? "border-[#0EA5E9] bg-sky-50 text-sky-900"
                      : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                  }`}
                >
                  {d.l}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 sm:col-span-2">
            <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
            <span className="text-sm text-slate-700">Activo</span>
          </label>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button
              type="submit"
              disabled={saving || days.length === 0}
              className="inline-flex items-center gap-1 rounded-xl bg-[#0EA5E9] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#0284C7] disabled:opacity-50"
            >
              <Plus className="h-4 w-4" aria-hidden />
              {draftId ? "Guardar cambios" : "Crear horario"}
            </button>
            {draftId ? (
              <button
                type="button"
                onClick={() => resetDraft()}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancelar edición
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-slate-700">Horarios configurados</h2>
        {loading || allowed === null ? (
          <p className="text-sm text-slate-400">Cargando…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500">Todavía no hay horarios. Creá uno arriba.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                  <th className="pb-2 pr-3">Nombre</th>
                  <th className="pb-2 pr-3">Franja</th>
                  <th className="pb-2 pr-3">Días</th>
                  <th className="pb-2 pr-3">Estado</th>
                  <th className="pb-2 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50">
                    <td className="py-3 pr-3 font-medium text-slate-800">{r.nombre}</td>
                    <td className="py-3 pr-3 tabular-nums text-slate-600">
                      {sliceTime(r.time_start)} – {sliceTime(r.time_end)}
                    </td>
                    <td className="py-3 pr-3 text-slate-600">{fmtDays(r.days_of_week ?? [])}</td>
                    <td className="py-3 pr-3">
                      {r.is_active !== false ? (
                        <span className="text-xs font-semibold text-emerald-700">Activo</span>
                      ) : (
                        <span className="text-xs text-slate-400">Inactivo</span>
                      )}
                    </td>
                    <td className="py-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => editRow(r)}
                        className="mr-2 text-xs font-semibold text-[#0EA5E9] hover:underline"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => void eliminar(r.id)}
                        disabled={saving}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-800 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
