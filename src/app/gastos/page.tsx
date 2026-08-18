"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getGastos, deleteGasto } from "@/lib/gastos/actions";
import type { Gasto } from "@/lib/gastos/actions";

function formatGs(valor: number) {
  return `${valor.toLocaleString("es-PY")} ₲`;
}

function formatFecha(fecha: string) {
  try {
    const d = new Date(fecha);
    return d.toLocaleDateString("es-PY", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return fecha;
  }
}

const tipoBadge: Record<string, string> = {
  fijo: "bg-blue-50 text-blue-700",
  variable: "bg-slate-100 text-slate-700",
};

export default function GastosPage() {
  const router = useRouter();
  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [eliminando, setEliminando] = useState<string | null>(null);

  useEffect(() => {
    getGastos()
      .then(setGastos)
      .catch(() => setGastos([]))
      .finally(() => setCargando(false));
  }, []);

  async function handleEliminar(g: Gasto) {
    if (!confirm(`¿Eliminar el gasto "${g.descripcion || g.categoria || "sin descripción"}"?`)) return;
    setEliminando(g.id);
    try {
      await deleteGasto(g.id);
      setGastos((prev) => prev.filter((x) => x.id !== g.id));
    } catch {
      setEliminando(null);
    } finally {
      setEliminando(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 rounded-full bg-[#4FAEB2]"
              style={{ boxShadow: "0 0 0 3px rgba(79, 174, 178, 0.18)" }}
            />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">
              Zentra · Egresos
            </p>
          </div>
          <h1 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">Gastos operativos</h1>
          <p className="mt-0.5 text-xs text-slate-500">Registro de gastos de la empresa</p>
        </div>
        <Link
          href="/gastos/nuevo"
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-[#4FAEB2]/25 transition-colors hover:bg-[#3F8E91] active:scale-95"
        >
          <span>+</span>
          Nuevo gasto
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm ring-1 ring-[#4FAEB2]/15">
        {cargando ? (
          <div className="py-16 text-center text-gray-400 text-sm animate-pulse">Cargando gastos…</div>
        ) : gastos.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <p className="text-4xl mb-3">📋</p>
            <p className="font-medium text-gray-600">No hay gastos registrados</p>
            <Link
              href="/gastos/nuevo"
              className="mt-4 inline-block text-sm text-[#0EA5E9] hover:underline"
            >
              Registrar primer gasto
            </Link>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left text-sm font-semibold text-slate-600 px-5 py-3">Fecha</th>
                <th className="text-left text-sm font-semibold text-slate-600 px-5 py-3">Categoría</th>
                <th className="text-left text-sm font-semibold text-slate-600 px-5 py-3">Descripción</th>
                <th className="text-left text-sm font-semibold text-slate-600 px-5 py-3">Monto</th>
                <th className="text-left text-sm font-semibold text-slate-600 px-5 py-3">Tipo</th>
                <th className="text-left text-sm font-semibold text-slate-600 px-5 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {gastos.map((g) => (
                <tr key={g.id} className="hover:bg-[#4FAEB2]/[0.04] transition-colors">
                  <td className="px-5 py-3.5 text-sm text-gray-600">{formatFecha(g.fecha)}</td>
                  <td className="px-5 py-3.5 text-sm font-medium text-gray-800">{g.categoria || "—"}</td>
                  <td className="px-5 py-3.5 text-sm text-gray-600 max-w-[200px] truncate">
                    {g.descripcion || "—"}
                  </td>
                  <td className="px-5 py-3.5 text-sm font-semibold text-gray-800 tabular-nums">
                    {formatGs(g.monto)}
                  </td>
                  <td className="px-5 py-3.5">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${tipoBadge[g.tipo] ?? "bg-slate-100"}`}
                    >
                      {g.tipo}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex gap-2">
                      <Link
                        href={`/gastos/${g.id}/editar`}
                        className="text-xs text-gray-500 hover:text-gray-800 underline"
                      >
                        Editar
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleEliminar(g)}
                        disabled={eliminando === g.id}
                        className="text-xs text-red-500 hover:text-red-700 underline disabled:opacity-50"
                      >
                        {eliminando === g.id ? "…" : "Eliminar"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {gastos.length > 0 && (
        <p className="text-sm text-gray-500">
          <span className="font-semibold text-gray-800">{gastos.length}</span> gastos
        </p>
      )}
    </div>
  );
}
