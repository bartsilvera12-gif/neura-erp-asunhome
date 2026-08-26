"use client";

/**
 * Reporte de rentabilidad con COSTO HISTÓRICO.
 * Ganancia = ingreso sin IVA − costo al momento de la venta (snapshot).
 * No cambia aunque el costo del producto se actualice después.
 */
import { useEffect, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import MesSelector from "@/components/reportes/MesSelector";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { mesActualAsuncion } from "@/lib/fechas/asuncion-bounds";

type ProdRow = {
  producto_nombre: string;
  cantidad: number;
  ingreso: number;
  costo: number;
  ganancia: number;
  margen: number;
};
type Reporte = {
  mes: string;
  totales: { ingreso: number; costo: number; ganancia: number; margen: number };
  por_producto: ProdRow[];
  sin_costo_items: number;
};

function formatGs(v: number) {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}

export default function RentabilidadReportePage() {
  const [mes, setMes] = useState(mesActualAsuncion());
  const [data, setData] = useState<Reporte | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    fetchWithSupabaseSession(`/api/reportes/rentabilidad?mes=${mes}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!cancel) { setData(j?.data ?? null); setCargando(false); } })
      .catch(() => { if (!cancel) setCargando(false); });
    return () => { cancel = true; };
  }, [mes]);

  const margenColor = (m: number) => (m >= 25 ? "text-emerald-700" : m >= 12 ? "text-amber-600" : "text-red-600");

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Reportes"
        title="Rentabilidad"
        description="Ganancia con el costo histórico de cada venta (no cambia si el costo se actualiza después)"
        backHref="/reportes"
        backLabel="Reportes"
        actions={<MesSelector mes={mes} onChange={setMes} />}
      />

      {cargando ? (
        <p className="text-slate-500 animate-pulse">Cargando…</p>
      ) : !data ? (
        <p className="text-slate-500">No se pudo cargar el reporte.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard compact label="Ingreso (sin IVA)" value={formatGs(data.totales.ingreso)} />
            <StatCard compact label="Costo histórico" value={formatGs(data.totales.costo)} />
            <StatCard compact label="Ganancia" value={formatGs(data.totales.ganancia)} accent />
            <StatCard compact label="Margen" value={`${data.totales.margen.toFixed(1)}%`} hint="ganancia / ingreso" />
          </div>

          {data.sin_costo_items > 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {data.sin_costo_items} línea(s) de ventas antiguas no tienen costo registrado y cuentan como costo 0 (pueden inflar la ganancia). Las ventas nuevas ya guardan el costo del momento.
            </p>
          )}

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-700">Por producto</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Producto</th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Cant.</th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Ingreso s/IVA</th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Costo</th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Ganancia</th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Margen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.por_producto.length === 0 ? (
                    <tr><td colSpan={6} className="py-10 text-center text-sm text-slate-400">Sin ventas en el período.</td></tr>
                  ) : (
                    data.por_producto.map((r) => (
                      <tr key={r.producto_nombre} className="hover:bg-slate-50/50">
                        <td className="px-4 py-2.5 font-medium text-slate-800">{r.producto_nombre}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{r.cantidad}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{formatGs(r.ingreso)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{formatGs(r.costo)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-900">{formatGs(r.ganancia)}</td>
                        <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${margenColor(r.margen)}`}>{r.margen.toFixed(1)}%</td>
                      </tr>
                    ))
                  )}
                </tbody>
                {data.por_producto.length > 0 && (
                  <tfoot className="border-t border-slate-200 bg-slate-50">
                    <tr>
                      <td className="px-4 py-3 text-sm font-bold text-slate-700">Total</td>
                      <td />
                      <td className="px-4 py-3 text-right text-sm font-bold tabular-nums text-slate-700">{formatGs(data.totales.ingreso)}</td>
                      <td className="px-4 py-3 text-right text-sm font-bold tabular-nums text-slate-500">{formatGs(data.totales.costo)}</td>
                      <td className="px-4 py-3 text-right text-sm font-bold tabular-nums text-slate-900">{formatGs(data.totales.ganancia)}</td>
                      <td className={`px-4 py-3 text-right text-sm font-bold tabular-nums ${margenColor(data.totales.margen)}`}>{data.totales.margen.toFixed(1)}%</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
