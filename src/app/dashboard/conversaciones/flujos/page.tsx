"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  isLikelyDuplicateFlowError,
  normalizeManualFlowCode,
  pickUniqueFlowCode,
  slugifyFlowCodeFromLabel,
} from "@/lib/chat/flow-code-slug";
import { getSorteoById } from "@/lib/sorteos/actions";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type FlowRow = {
  id: string;
  flow_code: string;
  label: string | null;
  channel: string;
  activo: boolean;
  node_count: number;
  updated_at: string;
  sorteo_id: string | null;
  sorteo_nombre: string | null;
};

function fmt(iso: string) {
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

function FlowsListContent() {
  const searchParams = useSearchParams();
  const sorteoIdParam = searchParams?.get("sorteo_id")?.trim() || null;

  const [rows, setRows] = useState<FlowRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<ReactNode>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [togglingCode, setTogglingCode] = useState<string | null>(null);
  const [duplicatingCode, setDuplicatingCode] = useState<string | null>(null);

  /** Nombre que ve el usuario en la lista (campo principal). */
  const [flowNombre, setFlowNombre] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  /** Solo si opciones avanzadas: sustituye la generación automática. */
  const [manualFlowCode, setManualFlowCode] = useState("");
  const [duplicateFrom, setDuplicateFrom] = useState("");

  const prefilledSorteoRef = useRef(false);

  const existingCodes = useMemo(() => new Set(rows.map((r) => r.flow_code)), [rows]);

  const previewBase = useMemo(() => {
    if (advancedOpen && manualFlowCode.trim()) {
      return normalizeManualFlowCode(manualFlowCode);
    }
    return slugifyFlowCodeFromLabel(flowNombre);
  }, [advancedOpen, manualFlowCode, flowNombre]);

  const previewResolved = useMemo(
    () => pickUniqueFlowCode(previewBase || "flujo", existingCodes),
    [previewBase, existingCodes],
  );

  async function reload(): Promise<FlowRow[]> {
    setLoading(true);
    try {
      const res = await fetchWithSupabaseSession("/api/chat/flows", {
        credentials: "same-origin",
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        items?: FlowRow[];
      };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Error al cargar flujos");
      const items = json.items ?? [];
      setRows(items);
      setError(null);
      setSuccess(null);
      return items;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar flujos");
      return [];
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  useEffect(() => {
    if (!sorteoIdParam || prefilledSorteoRef.current) return;
    prefilledSorteoRef.current = true;
    void getSorteoById(sorteoIdParam).then((s) => {
      if (!s) return;
      setFlowNombre((prev) => (prev.trim() ? prev : s.nombre.trim()));
    });
  }, [sorteoIdParam]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const nombre = flowNombre.trim();
    if (!nombre) {
      setError("Ingresá el nombre del flujo.");
      return;
    }

    const base =
      advancedOpen && manualFlowCode.trim()
        ? normalizeManualFlowCode(manualFlowCode)
        : slugifyFlowCodeFromLabel(nombre);

    if (!base) {
      setError("No se pudo generar el identificador interno. Probá otro nombre o editá el código en opciones avanzadas.");
      return;
    }

    setCreating(true);
    setError(null);
    setSuccess(null);

    try {
      let list = rows;
      let flowCode = pickUniqueFlowCode(base, new Set(list.map((r) => r.flow_code)));
      let lastErr = "";

      for (let attempt = 0; attempt < 6; attempt++) {
        const res = await fetchWithSupabaseSession("/api/chat/flows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            flow_code: flowCode,
            label: nombre,
            duplicate_from: duplicateFrom.trim() || undefined,
          }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          flow_code?: string;
          error?: string;
        };

        if (res.ok && json.ok) {
          const created = json.flow_code ?? flowCode;
          list = await reload();
          setFlowNombre("");
          setManualFlowCode("");
          setDuplicateFrom("");
          setAdvancedOpen(false);

          const editorHref = `/configuracion/conversaciones/flujos/${encodeURIComponent(created)}`;
          setSuccess(
            <>
              Flujo creado.{" "}
              <Link href={editorHref} className="font-semibold text-emerald-800 underline underline-offset-2">
                Abrir editor
              </Link>
              {sorteoIdParam ? " para vincular el sorteo y los mensajes." : " para configurar mensajes y pasos."}
            </>,
          );
          return;
        }

        lastErr = json.error ?? `HTTP ${res.status}`;
        if (attempt < 5 && isLikelyDuplicateFlowError(lastErr)) {
          list = await reload();
          flowCode = pickUniqueFlowCode(base, new Set(list.map((r) => r.flow_code)));
          continue;
        }
        throw new Error(lastErr || "Error al crear flujo");
      }
      throw new Error(lastErr || "No se pudo crear el flujo tras varios intentos.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al crear flujo");
    } finally {
      setCreating(false);
    }
  }

  async function toggleFlow(flowCode: string, activo: boolean) {
    setTogglingCode(flowCode);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetchWithSupabaseSession(`/api/chat/flows/${encodeURIComponent(flowCode)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ activo: !activo }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "No se pudo actualizar estado");
      await reload();
      setSuccess(`Flujo ${flowCode} ${activo ? "desactivado" : "activado"} correctamente.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al actualizar estado");
    } finally {
      setTogglingCode(null);
    }
  }

  async function duplicateFlow(sourceFlowCode: string) {
    const suggested = `${sourceFlowCode}_copy`;
    const newFlowCode = prompt("Nuevo flow_code para duplicar:", suggested)?.trim() || "";
    if (!newFlowCode) return;
    setDuplicatingCode(sourceFlowCode);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetchWithSupabaseSession("/api/chat/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          flow_code: newFlowCode,
          label: `${newFlowCode}`,
          duplicate_from: sourceFlowCode,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "No se pudo duplicar flujo");
      await reload();
      setSuccess(`Flujo ${sourceFlowCode} duplicado como ${newFlowCode}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al duplicar flujo");
    } finally {
      setDuplicatingCode(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between gap-3 items-start">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Flujos conversacionales</h1>
          <p className="text-sm text-slate-600 mt-1">Creá el flujo que usará tu bot de WhatsApp</p>
        </div>
        <Link
          href="/configuracion/canales"
          className="text-sm font-medium text-[#0EA5E9] hover:underline px-3 py-2 rounded-lg border border-sky-200 bg-sky-50"
        >
          Ir a Canales y comunicación
        </Link>
      </div>

      {sorteoIdParam ? (
        <p className="text-sm text-sky-800 bg-sky-50 border border-sky-100 rounded-lg px-3 py-2">
          Podés asociar este sorteo en el editor del flujo después de crearlo.
        </p>
      ) : null}

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</div>}
      {success && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2">{success}</div>}

      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <form noValidate onSubmit={handleCreate} className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="flex-1 min-w-0 space-y-1">
              <label htmlFor="flow-nombre" className="block text-sm font-semibold text-slate-800">
                Nombre del flujo
              </label>
              <input
                id="flow-nombre"
                type="text"
                autoComplete="off"
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm"
                placeholder="Ej: Sorteo Kita Peña"
                value={flowNombre}
                onChange={(e) => setFlowNombre(e.target.value)}
              />
              <p className="text-xs text-slate-500">Así se verá en tu lista.</p>
              <p className="text-xs text-slate-500 font-mono mt-2">
                ID interno: <span className="text-slate-700">{previewResolved || "—"}</span>
              </p>
            </div>
            <button
              type="submit"
              disabled={creating}
              className="shrink-0 bg-[#0EA5E9] hover:bg-[#0284C7] disabled:opacity-50 text-white px-6 py-2.5 rounded-lg text-sm font-semibold"
            >
              {creating ? "Creando…" : "Crear flujo"}
            </button>
          </div>

          <div className="rounded-lg border border-slate-100 bg-slate-50/80 overflow-hidden">
            <label className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
              <input
                type="checkbox"
                className="rounded border-slate-300 text-[#0EA5E9] focus:ring-[#0EA5E9]"
                checked={advancedOpen}
                onChange={(e) => {
                  const on = e.target.checked;
                  setAdvancedOpen(on);
                  if (!on) {
                    setManualFlowCode("");
                    setDuplicateFrom("");
                  }
                }}
              />
              Opciones avanzadas
            </label>
            {advancedOpen ? (
              <div className="px-3 pb-3 pt-0 space-y-3 border-t border-slate-100">
                <div className="space-y-1">
                  <label htmlFor="flow-code-manual" className="block text-xs font-medium text-slate-600">
                    ID interno personalizado (opcional)
                  </label>
                  <input
                    id="flow-code-manual"
                    type="text"
                    autoComplete="off"
                    className="w-full max-w-md border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono bg-white"
                    placeholder="Vacío = se genera desde el nombre del flujo"
                    value={manualFlowCode}
                    onChange={(e) => setManualFlowCode(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="flow-duplicate-from" className="block text-xs font-medium text-slate-600">
                    Copiar pasos desde otro flujo (opcional)
                  </label>
                  <input
                    id="flow-duplicate-from"
                    type="text"
                    className="w-full max-w-md border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono bg-white"
                    placeholder="ID interno del flujo plantilla"
                    value={duplicateFrom}
                    onChange={(e) => setDuplicateFrom(e.target.value)}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </form>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 text-sm font-semibold text-slate-700">Listado</div>
        {loading ? (
          <div className="p-6 text-sm text-slate-400 animate-pulse">Cargando...</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">Todavía no creaste ningún flujo.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left px-4 py-2">Nombre</th>
                  <th className="text-left px-4 py-2">ID interno</th>
                  <th className="text-left px-4 py-2">Canal</th>
                  <th className="text-left px-4 py-2">Estado</th>
                  <th className="text-left px-4 py-2">Nodos</th>
                  <th className="text-left px-4 py-2">Sorteo</th>
                  <th className="text-left px-4 py-2">Actualizado</th>
                  <th className="text-left px-4 py-2">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-medium text-slate-800">{r.label || r.flow_code}</td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">{r.flow_code}</td>
                    <td className="px-4 py-2">{r.channel}</td>
                    <td className="px-4 py-2">
                      {r.activo ? <span className="text-emerald-600">Activo</span> : <span className="text-amber-600">Inactivo</span>}
                    </td>
                    <td className="px-4 py-2">{r.node_count}</td>
                    <td className="px-4 py-2">
                      {r.sorteo_id ? (
                        <span className="text-emerald-700 text-xs font-medium">{r.sorteo_nombre || "Sí"}</span>
                      ) : (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2">{fmt(r.updated_at)}</td>
                    <td className="px-4 py-2 flex gap-3">
                      <Link href={`/configuracion/conversaciones/flujos/${encodeURIComponent(r.flow_code)}`} className="text-[#0EA5E9] hover:underline">
                        Editar
                      </Link>
                      <button type="button" onClick={() => void toggleFlow(r.flow_code, r.activo)} className="text-slate-600 hover:underline" disabled={togglingCode === r.flow_code}>
                        {togglingCode === r.flow_code ? "..." : r.activo ? "Desactivar" : "Activar"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void duplicateFlow(r.flow_code)}
                        className="text-slate-600 hover:underline"
                        disabled={duplicatingCode === r.flow_code}
                      >
                        {duplicatingCode === r.flow_code ? "..." : "Duplicar"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function FlowsListFallback() {
  return <div className="p-6 text-sm text-slate-400">Cargando flujos…</div>;
}

export default function FlowsListPage() {
  return (
    <Suspense fallback={<FlowsListFallback />}>
      <FlowsListContent />
    </Suspense>
  );
}
