"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import ExportExcelButton from "@/components/ui/ExportExcelButton";
import MesSelector from "@/components/reportes/MesSelector";
import { getVentasReporte } from "@/lib/reportes/storage";
import { mesActualAsuncion } from "@/lib/fechas/asuncion-bounds";
import type { VentasReporte, TipoPrecioReporte } from "@/lib/reportes/types";

function formatGs(v: number) {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}
function formatFecha(iso: string) {
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  } catch {
    return iso;
  }
}
const TP: { key: TipoPrecioReporte; label: string; badge: string }[] = [
  { key: "minorista", label: "Minorista", badge: "bg-slate-100 text-slate-600" },
  { key: "mayorista", label: "Mayorista", badge: "bg-indigo-100 text-indigo-700" },
  { key: "distribuidor", label: "Distribuidor", badge: "bg-emerald-100 text-emerald-700" },
  { key: "costo", label: "Al costo", badge: "bg-amber-100 text-amber-700" },
];

export default function VentasReportePage() {
  const [mes, setMes] = useState(mesActualAsuncion());
  const [data, setData] = useState<VentasReporte | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    getVentasReporte(mes).then((d) => { if (!cancel) { setData(d); setCargando(false); } });
    return () => { cancel = true; };
  }, [mes]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Zentra · Reportes"
        title="Ventas"
        description="Facturación y operaciones comerciales del período"
        backHref="/reportes"
        backLabel="Reportes"
        actions={
          <div className="flex items-center gap-3">
            <MesSelector mes={mes} onChange={setMes} />
            <ExportExcelButton url={`/api/reportes/ventas/export?mes=${mes}`} />
          </div>
        }
      />

      {cargando ? (
        <p className="text-slate-500 animate-pulse">Cargando…</p>
      ) : !data ? (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 text-slate-500">
          No se pudo cargar el reporte de ventas.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard compact label="Total vendido" value={formatGs(data.totalVendido)} accent />
            <StatCard compact label="Ventas" value={String(data.cantidadVentas)} hint={`${data.cantidadItems} ítems / líneas`} />
            <StatCard compact label="Ticket promedio" value={formatGs(data.ticketPromedio)} hint="por venta" />
            <StatCard compact label="Unidades vendidas" value={String(data.unidadesVendidas)} />
            <StatCard compact label="Ítems vendidos" value={String(data.cantidadItems)} />
          </div>

          {/* Desglose por tipo de precio */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
            <h2 className="text-base font-semibold text-slate-800 mb-4">Por tipo de precio</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {TP.map(({ key, label, badge }) => (
                <div key={key} className="rounded-xl border border-slate-200 p-4">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge}`}>{label}</span>
                  <p className="mt-2 text-lg font-bold tabular-nums text-slate-800">{formatGs(data.porTipoPrecio[key].total)}</p>
                  <p className="text-xs text-slate-400">{data.porTipoPrecio[key].items} {data.porTipoPrecio[key].items === 1 ? "ítem" : "ítems"}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Detalle de ventas */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
            <h2 className="text-base font-semibold text-slate-800 mb-4">Ventas del mes</h2>
            {data.ventas.length === 0 ? (
              <p className="text-sm text-slate-400">No hay ventas en el período.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead>
                    <tr className="border-b text-slate-500">
                      <th className="py-2.5 pr-4 font-medium">Fecha</th>
                      <th className="py-2.5 pr-4 font-medium">N° Venta</th>
                      <th className="py-2.5 pr-4 font-medium">Cliente</th>
                      <th className="py-2.5 pr-4 font-medium">Pago</th>
                      <th className="py-2.5 pr-4 font-medium text-right">Ítems</th>
                      <th className="py-2.5 font-medium text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.ventas.map((v) => (
                      <tr key={v.id} className="border-b border-slate-100 last:border-0">
                        <td className="py-3 pr-4 text-slate-600 text-xs tabular-nums">{formatFecha(v.fecha)}</td>
                        <td className="py-3 pr-4 font-mono text-xs text-slate-500">{v.numero_control}</td>
                        <td className="py-3 pr-4 text-slate-700">{v.cliente ?? "—"}</td>
                        <td className="py-3 pr-4 text-slate-600 capitalize">{v.metodo_pago ?? "—"}</td>
                        <td className="py-3 pr-4 text-right tabular-nums text-slate-700">{v.items_count}</td>
                        <td className="py-3 text-right tabular-nums font-semibold text-slate-800">{formatGs(v.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Total por producto */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
            <h2 className="text-base font-semibold text-slate-800 mb-4">Total por producto</h2>
            {data.porProducto.length === 0 ? (
              <p className="text-sm text-slate-400">Sin datos.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b text-slate-500">
                      <th className="py-2.5 pr-4 font-medium">Producto</th>
                      <th className="py-2.5 pr-4 font-medium text-right">Cantidad</th>
                      <th className="py-2.5 font-medium text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.porProducto.map((p, i) => (
                      <tr key={i} className="border-b border-slate-100 last:border-0">
                        <td className="py-2.5 pr-4 text-slate-700">{p.producto_nombre}</td>
                        <td className="py-2.5 pr-4 text-right tabular-nums text-slate-600">{p.cantidad}</td>
                        <td className="py-2.5 text-right tabular-nums font-semibold text-slate-800">{formatGs(p.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
