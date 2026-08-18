"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ExportExcelButton from "@/components/ui/ExportExcelButton";
import ImportExcelButton from "@/components/ui/ImportExcelButton";
import { useIsAdmin } from "@/lib/auth/use-is-admin";

interface Ubicacion {
  id: string;
  nombre: string;
  codigo: string | null;
  tipo: string;
  parent_id: string | null;
  activo: boolean;
}

const TIPOS = ["deposito","salon","pasillo","gondola","estante","zona","otro"] as const;

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
  useEffect(() => { load(); }, []);

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
        setNombre(""); setCodigo(""); setTipo("deposito"); setParentId("");
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

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Depósitos y ubicaciones</h1>
          <p className="text-gray-600">
            Donde se almacena físicamente cada producto: depósitos, salones, pasillos, góndolas, estantes, zonas.
          </p>
        </div>
        <div className="flex items-center gap-3">
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
          <Link href="/inventario" className="text-sm text-sky-700 hover:text-sky-900 underline">
            ← Volver a Inventario
          </Link>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 max-w-3xl">
        <p className="text-xs text-gray-400 mb-3 uppercase tracking-wide font-semibold">
          Nueva ubicación
        </p>
        <form onSubmit={handleCrear} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div className="md:col-span-2">
            <label className="block text-xs text-gray-600 mb-1">Nombre</label>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Depósito central"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Código (opcional)</label>
            <input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="Ej: DEP-01"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Tipo</label>
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
            >
              {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="md:col-span-3">
            <label className="block text-xs text-gray-600 mb-1">Ubicación padre (opcional)</label>
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="">— ninguna —</option>
              {items.filter((i) => i.activo).map((i) => (
                <option key={i.id} value={i.id}>{i.nombre} ({i.tipo})</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-4">
            <button
              type="submit"
              disabled={creating || !nombre.trim()}
              className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white text-sm px-4 py-2 rounded-lg disabled:opacity-50"
            >
              {creating ? "Creando..." : "Crear ubicación"}
            </button>
          </div>
        </form>
        {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-gray-400">Cargando...</p>
        ) : items.length === 0 ? (
          <p className="p-6 text-sm text-gray-400">Todavía no cargaste ubicaciones.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2">Nombre</th>
                <th className="text-left px-4 py-2">Tipo</th>
                <th className="text-left px-4 py-2">Código</th>
                <th className="text-left px-4 py-2">Padre</th>
                <th className="text-left px-4 py-2">Estado</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => {
                const parent = items.find((i) => i.id === u.parent_id);
                return (
                  <tr key={u.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-medium">{u.nombre}</td>
                    <td className="px-4 py-2 text-gray-500">{u.tipo}</td>
                    <td className="px-4 py-2 text-gray-500">{u.codigo ?? "—"}</td>
                    <td className="px-4 py-2 text-gray-500">{parent?.nombre ?? "—"}</td>
                    <td className="px-4 py-2">
                      {u.activo ? (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">Activo</span>
                      ) : (
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">Inactivo</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => toggleActivo(u)}
                        className="text-xs text-sky-700 hover:text-sky-900 underline"
                      >
                        {u.activo ? "Desactivar" : "Activar"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
