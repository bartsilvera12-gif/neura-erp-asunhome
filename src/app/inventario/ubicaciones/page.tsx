"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Warehouse, Plus, MapPin, Loader2, Store, Rows3, LayoutGrid, Boxes, Map, Package } from "lucide-react";
import ExportExcelButton from "@/components/ui/ExportExcelButton";
import ImportExcelButton from "@/components/ui/ImportExcelButton";
import { FancySelect } from "@/components/ui/FancySelect";
import { useIsAdmin } from "@/lib/auth/use-is-admin";

interface Ubicacion {
  id: string;
  nombre: string;
  codigo: string | null;
  tipo: string;
  parent_id: string | null;
  activo: boolean;
}

const TIPOS = ["deposito", "salon", "pasillo", "gondola", "estante", "zona", "otro"] as const;

type TipoMeta = { label: string; badge: string; icon: React.ComponentType<{ className?: string }> };
const TIPO_META: Record<string, TipoMeta> = {
  deposito: { label: "Depósito", badge: "bg-[#4FAEB2]/12 text-[#3F8E91] border-[#4FAEB2]/30", icon: Warehouse },
  salon: { label: "Salón", badge: "bg-indigo-50 text-indigo-700 border-indigo-200", icon: Store },
  pasillo: { label: "Pasillo", badge: "bg-amber-50 text-amber-700 border-amber-200", icon: Rows3 },
  gondola: { label: "Góndola", badge: "bg-violet-50 text-violet-700 border-violet-200", icon: LayoutGrid },
  estante: { label: "Estante", badge: "bg-sky-50 text-sky-700 border-sky-200", icon: Boxes },
  zona: { label: "Zona", badge: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: Map },
  otro: { label: "Otro", badge: "bg-slate-100 text-slate-600 border-slate-200", icon: MapPin },
};
const tipoMeta = (t: string): TipoMeta => TIPO_META[t] ?? TIPO_META.otro;

const inputClass =
  "w-full h-10 rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 shadow-sm outline-none transition-all placeholder:text-slate-400 hover:border-[#4FAEB2]/60 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";

export default function UbicacionesPage() {
  const { isAdmin } = useIsAdmin();
  const [items, setItems] = useState<Ubicacion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [tipo, setTipo] = useState<string>("deposito");
  const [parentId, setParentId] = useState("");
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/inventario/ubicaciones?todas=1", { credentials: "include" });
      const j = await r.json();
      if (r.ok && j?.success) setItems(j.data.ubicaciones as Ubicacion[]);
      else setError(j?.error ?? "No se pudo cargar.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function handleCrear(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const r = await fetch("/api/inventario/ubicaciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          nombre: nombre.trim(),
          codigo: codigo.trim() || null,
          tipo,
          parent_id: parentId || null,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) {
        setError(j?.error ?? "No se pudo crear.");
      } else {
        setNombre("");
        setCodigo("");
        setTipo("deposito");
        setParentId("");
        await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setCreating(false);
    }
  }

  async function toggleActivo(u: Ubicacion) {
    const r = await fetch(`/api/inventario/ubicaciones/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ activo: !u.activo }),
    });
    const j = await r.json();
    if (r.ok && j?.success) load();
    else setError(j?.error ?? "No se pudo actualizar.");
  }

  const activas = useMemo(() => items.filter((i) => i.activo).length, [items]);

  return (
    <div className="w-full py-8 px-4 sm:px-6 lg:px-8 space-y-6">
      {/* Header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-[#4FAEB2]/8 border border-[#4FAEB2]/30 px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#3F8E91] mb-3">
            <Warehouse className="h-3 w-3 text-[#4FAEB2]" />
            Inventario · Ubicaciones
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-800 tracking-tight leading-tight">
            Depósitos y ubicaciones
          </h1>
          <p className="text-[14px] text-slate-500 mt-1.5 max-w-2xl">
            Dónde se almacena físicamente cada producto: depósitos, salones, pasillos, góndolas, estantes y zonas.
          </p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <ExportExcelButton url="/api/inventario/ubicaciones/export" />
          <ImportExcelButton
            entidad="Ubicaciones"
            previewUrl="/api/inventario/ubicaciones/import/preview"
            commitUrl="/api/inventario/ubicaciones/import/commit"
            templateUrl="/api/inventario/ubicaciones/import/template"
            permiteCrearFaltantes
            visible={isAdmin}
            onCompleted={load}
          />
          <Link
            href="/inventario"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-[#4FAEB2] hover:text-[#3F8E91] transition-colors"
          >
            ← Volver a Inventario
          </Link>
        </div>
      </header>

      {/* Nueva ubicación — sin overflow-hidden para que el menú del FancySelect no se corte */}
      <section className="bg-white rounded-2xl border-2 border-[#4FAEB2]/20 shadow-[0_2px_10px_-2px_rgba(79,174,178,0.12)]">
        <div className="rounded-t-[14px] px-5 py-4 border-b border-[#4FAEB2]/15 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent">
          <h2 className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider text-slate-700">
            <span className="inline-block h-3.5 w-1 rounded-full bg-[#4FAEB2]" />
            Nueva ubicación
          </h2>
        </div>
        <form onSubmit={handleCrear} className="p-5 grid grid-cols-1 md:grid-cols-6 gap-4 items-end">
          <div className="md:col-span-3">
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">Nombre</label>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Depósito central"
              className={inputClass}
              required
            />
          </div>
          <div className="md:col-span-1">
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">Código <span className="font-normal text-slate-400">(opc.)</span></label>
            <input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="DEP-01"
              className={`${inputClass} font-mono`}
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">Tipo</label>
            <FancySelect
              ariaLabel="Tipo de ubicación"
              value={tipo}
              onChange={setTipo}
              options={TIPOS.map((t) => ({ value: t, label: tipoMeta(t).label }))}
            />
          </div>
          <div className="md:col-span-4">
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">Ubicación padre <span className="font-normal text-slate-400">(opcional)</span></label>
            <FancySelect
              ariaLabel="Ubicación padre"
              value={parentId}
              onChange={setParentId}
              placeholder="— ninguna —"
              options={[
                { value: "", label: "— ninguna —" },
                ...items
                  .filter((i) => i.activo)
                  .map((i) => ({ value: i.id, label: i.nombre, description: tipoMeta(i.tipo).label })),
              ]}
            />
          </div>
          <div className="md:col-span-2 flex md:justify-end">
            <button
              type="submit"
              disabled={creating || !nombre.trim()}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#4FAEB2] hover:bg-[#3F8E91] text-white text-sm font-bold px-5 h-10 transition-colors shadow-sm shadow-[#4FAEB2]/30 disabled:opacity-50 disabled:cursor-not-allowed w-full md:w-auto"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" strokeWidth={2.5} />}
              {creating ? "Creando…" : "Crear ubicación"}
            </button>
          </div>
          {error && (
            <p className="md:col-span-6 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
        </form>
      </section>

      {/* Listado */}
      <section className="bg-white rounded-2xl border-2 border-[#4FAEB2]/20 shadow-[0_2px_10px_-2px_rgba(79,174,178,0.12)] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#4FAEB2]/15 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider text-slate-700">
            <span className="inline-block h-3.5 w-1 rounded-full bg-[#4FAEB2]" />
            Ubicaciones
          </h2>
          {!loading && items.length > 0 && (
            <span className="text-xs text-slate-500">
              <span className="font-bold text-slate-700">{items.length}</span> total ·{" "}
              <span className="font-bold text-[#3F8E91]">{activas}</span> activas
            </span>
          )}
        </div>

        {loading ? (
          <p className="px-5 py-12 text-center text-sm text-slate-400 animate-pulse">Cargando…</p>
        ) : items.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-[#4FAEB2]/8 border border-[#4FAEB2]/20 mb-3">
              <Package className="h-6 w-6 text-[#4FAEB2]" />
            </div>
            <p className="text-sm font-semibold text-slate-700">Todavía no cargaste ubicaciones</p>
            <p className="mt-1 text-xs text-slate-400">Creá tu primer depósito o ubicación con el formulario de arriba.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-slate-50/70 text-slate-500 text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3 font-semibold">Nombre</th>
                  <th className="px-3 py-3 font-semibold">Tipo</th>
                  <th className="px-3 py-3 font-semibold">Código</th>
                  <th className="px-3 py-3 font-semibold">Ubicación padre</th>
                  <th className="px-3 py-3 font-semibold">Estado</th>
                  <th className="px-3 py-3 text-right font-semibold">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((u) => {
                  const parent = items.find((i) => i.id === u.parent_id);
                  const meta = tipoMeta(u.tipo);
                  const Icon = meta.icon;
                  return (
                    <tr key={u.id} className="hover:bg-[#4FAEB2]/[0.04] transition-colors">
                      <td className="px-5 py-3">
                        <span className={`font-semibold ${u.activo ? "text-slate-800" : "text-slate-400"}`}>{u.nombre}</span>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${meta.badge}`}>
                          <Icon className="h-3 w-3" />
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-slate-500">{u.codigo ?? "—"}</td>
                      <td className="px-3 py-3 text-slate-600">{parent?.nombre ?? <span className="text-slate-300">—</span>}</td>
                      <td className="px-3 py-3">
                        {u.activo ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Activo</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-500">Inactivo</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button
                          onClick={() => toggleActivo(u)}
                          className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors ${
                            u.activo
                              ? "border-slate-200 bg-white text-slate-600 hover:border-amber-300 hover:text-amber-700"
                              : "border-[#4FAEB2]/40 bg-white text-[#3F8E91] hover:bg-[#4FAEB2]/10"
                          }`}
                        >
                          {u.activo ? "Desactivar" : "Activar"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
