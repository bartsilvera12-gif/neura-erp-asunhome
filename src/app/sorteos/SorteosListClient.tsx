"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSorteos } from "@/lib/sorteos/actions";
import type { SorteosVentasKpis } from "@/lib/sorteos/ventas-kpis";
import type { Sorteo } from "@/lib/sorteos/types";

function formatGs(n: number) {
  const s = Math.round(n).toLocaleString("es-PY", { maximumFractionDigits: 0 });
  return `Gs. ${s}`;
}

function formatFecha(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-PY", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

const estadoClass: Record<string, string> = {
  activo: "bg-emerald-50 text-emerald-800",
  pausado: "bg-amber-50 text-amber-800",
  cerrado: "bg-slate-100 text-slate-700",
  finalizado: "bg-blue-50 text-blue-800",
};

function KpiCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm min-w-[140px] flex-1">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-xl font-bold tabular-nums text-slate-900 mt-1">{value}</p>
      {sub ? <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p> : null}
    </div>
  );
}

export default function SorteosListClient({ ventasKpis }: { ventasKpis: SorteosVentasKpis }) {
  const [rows, setRows] = useState<Sorteo[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    getSorteos()
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setCargando(false));
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Sorteos</h1>
          <p className="text-gray-500 text-sm mt-0.5">Gestión de sorteos y boletos</p>
        </div>
        <Link
          href="/sorteos/nuevo"
          className="shrink-0 bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors shadow-sm self-start"
        >
          Nuevo sorteo
        </Link>
      </div>

      <nav className="flex flex-wrap gap-4 text-sm border-b border-slate-200 pb-2.5">
        <span className="font-semibold text-[#0EA5E9] border-b-2 border-[#0EA5E9] -mb-2.5 pb-2.5">
          Sorteos
        </span>
        <Link href="/sorteos/entradas" className="text-slate-600 hover:text-[#0EA5E9] pb-2">
          Entradas
        </Link>
        <Link href="/sorteos/cupones" className="text-slate-600 hover:text-[#0EA5E9] pb-2">
          Cupones
        </Link>
      </nav>

      <div className="flex flex-wrap gap-3">
        <KpiCard label="Boletos hoy" value={ventasKpis.boletosHoy.toLocaleString("es-PY")} sub="Vendidos hoy" />
        <KpiCard label="Boletos mes" value={ventasKpis.boletosMes.toLocaleString("es-PY")} sub="Vendidos este mes" />
        <KpiCard label="Monto hoy" value={formatGs(ventasKpis.montoHoy)} sub="Ingresos de hoy" />
        <KpiCard label="Monto mes" value={formatGs(ventasKpis.montoMes)} sub="Ingresos del mes" />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        {cargando ? (
          <div className="py-16 text-center text-gray-400 text-sm animate-pulse">Cargando…</div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <p className="font-medium text-gray-600">No hay sorteos</p>
            <Link href="/sorteos/nuevo" className="mt-3 inline-block text-sm text-[#0EA5E9] hover:underline">
              Crear el primero
            </Link>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left text-sm font-semibold text-slate-600 px-5 py-3">Nombre</th>
                <th className="text-left text-sm font-semibold text-slate-600 px-5 py-3">Estado</th>
                <th className="text-left text-sm font-semibold text-slate-600 px-5 py-3">Fecha sorteo</th>
                <th className="text-right text-sm font-semibold text-slate-600 px-5 py-3">Precio / boleto</th>
                <th className="text-right text-sm font-semibold text-slate-600 px-5 py-3">Máx.</th>
                <th className="text-right text-sm font-semibold text-slate-600 px-5 py-3">Vendidos</th>
                <th className="text-left text-sm font-semibold text-slate-600 px-5 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/80">
                  <td className="px-5 py-3 text-sm text-slate-800 font-medium">{s.nombre}</td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-flex text-xs font-medium px-2 py-0.5 rounded-full ${estadoClass[s.estado] ?? "bg-slate-100"}`}
                    >
                      {s.estado}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-sm text-slate-600">{formatFecha(s.fecha_sorteo)}</td>
                  <td className="px-5 py-3 text-sm text-right tabular-nums">{formatGs(s.precio_por_boleto)}</td>
                  <td className="px-5 py-3 text-sm text-right tabular-nums">{s.max_boletos}</td>
                  <td className="px-5 py-3 text-sm text-right tabular-nums">{s.total_boletos_vendidos}</td>
                  <td className="px-5 py-3">
                    <Link href={`/sorteos/${s.id}/editar`} className="text-sm text-[#0EA5E9] hover:underline">
                      Editar
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
