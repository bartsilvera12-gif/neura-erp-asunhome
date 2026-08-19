"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { ChefHat, Plus, Loader2 } from "lucide-react";
import { formatUnidad } from "@/lib/unidades/format";

type RecetaRow = {
  id: string;
  producto_id: string;
  nombre: string | null;
  producto_nombre: string | null;
  rendimiento_cantidad: number;
  rendimiento_unidad: string | null;
  activa: boolean;
  updated_at: string;
};

export default function RecetasListPage() {
  const [recetas, setRecetas] = useState<RecetaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetchWithSupabaseSession("/api/recetas", { cache: "no-store" });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok || body?.success === false) {
          setError(body?.error ?? "Error al cargar recetas");
          setRecetas([]);
        } else {
          setRecetas(body.data?.recetas ?? []);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 rounded-full bg-[#4FAEB2]"
              style={{ boxShadow: "0 0 0 3px rgba(79, 174, 178, 0.18)" }}
            />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">
              Zentra · Cocina
            </p>
          </div>
          <div className="mt-1 flex items-center gap-3">
            <ChefHat className="h-5 w-5 text-[#4FAEB2]" />
            <h1 className="text-lg font-semibold tracking-tight text-slate-900">Recetas</h1>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">Recetario de productos preparados por el local.</p>
        </div>
        <Link
          href="/dashboard/recetas/nueva"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-[#4FAEB2]/25 transition-colors hover:bg-[#3F8E91] active:scale-95"
        >
          <Plus className="h-4 w-4" />
          Nueva receta
        </Link>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      )}

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && recetas.length === 0 && (
        <div className="rounded-md border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
          Todavía no hay recetas. Creá la primera para empezar a costear tus productos.
        </div>
      )}

      {!loading && recetas.length > 0 && (
        /* overflow-x-auto + min-w para que el link "Editar" no se corte en mobile.
           "Actualizado" se oculta en mobile (data secundaria). */
        <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
          <table className="w-full min-w-[680px] sm:min-w-0 text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2">Nombre</th>
                <th className="px-4 py-2">Rendimiento</th>
                <th className="px-4 py-2">Estado</th>
                <th className="px-4 py-2 hidden md:table-cell">Actualizado</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recetas.map((r) => (
                <tr key={r.id} className="hover:bg-[#4FAEB2]/[0.04] transition-colors">
                  <td className="px-4 py-2 font-medium text-gray-900">
                    {r.nombre?.trim()
                      ? r.nombre
                      : r.producto_nombre
                        ? <span>Receta: {r.producto_nombre}</span>
                        : <span className="text-gray-400">(sin nombre)</span>}
                  </td>
                  <td className="px-4 py-2 text-gray-700">
                    {r.rendimiento_cantidad} {formatUnidad(r.rendimiento_unidad)}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs ${
                        r.activa ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {r.activa ? "Activa" : "Inactiva"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500 hidden md:table-cell">
                    {new Date(r.updated_at).toLocaleString("es-PY")}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      href={`/dashboard/recetas/${r.id}`}
                      className="text-amber-600 hover:text-amber-700"
                    >
                      Editar
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
