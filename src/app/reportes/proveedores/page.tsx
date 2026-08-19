"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import ExportExcelButton from "@/components/ui/ExportExcelButton";
import MesSelector from "@/components/reportes/MesSelector";
import { getProveedoresReporte } from "@/lib/reportes/storage";
import { mesActualAsuncion } from "@/lib/fechas/asuncion-bounds";
import type { ProveedoresReporte } from "@/lib/reportes/types";

function formatGs(v: number) {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}
function formatFecha(iso: string | null) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  } catch {
    return "—";
  }
}

export default function ProveedoresReportePage() {
  const [mes, setMes] = useState(mesActualAsuncion());
  const [data, setData] = useState<ProveedoresReporte | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    getProveedoresReporte(mes).then((d) => { if (!cancel) { setData(d); setCargando(false); } });
    return () => { cancel = true; };
  }, [mes]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Zentra · Reportes"
        title="Proveedores"
        description="Abastecimiento y relación comercial del período"
        backHref="/reportes"
        backLabel="Reportes"
        actions={
          <div className="flex items-center gap-3">
            <MesSelector mes={mes} onChange={setMes} />
            <ExportExcelButton url={`/api/reportes/proveedores/export?mes=${mes}`} />
          </div>
        }
      />

      {cargando ? (
        <p className="text-slate-500 animate-pulse">Cargando…</p>
      ) : !data ? (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 text-slate-500">
          No se pudo cargar el reporte de proveedores.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard compact label="Total proveedores" value={String(data.totalProveedores)} accent />
            <StatCard compact label="Con compras (mes)" value={String(data.conCompras)} />
            <StatCard compact label="Total comprado (mes)" value={formatGs(data.totalComprado)} />
            <StatCard compact label="Compra promedio" value={formatGs(data.compraPromedio)} hint="por proveedor activo" />
            <StatCard
              compact
              label="Última compra"
              value={data.ultimaCompra ? formatGs(data.ultimaCompra.total) : "—"}
              hint={data.ultimaCompra ? `${data.ultimaCompra.numero_control} · ${formatFecha(data.ultimaCompra.fecha)}` : "Sin compras en el mes"}
            />
          </div>

          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
            <h2 className="text-base font-semibold text-slate-800 mb-4">Proveedores</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr className="border-b text-slate-500">
                    <th className="py-2.5 pr-4 font-medium">Proveedor</th>
                    <th className="py-2.5 pr-4 font-medium">RUC</th>
                    <th className="py-2.5 pr-4 font-medium">Teléfono</th>
                    <th className="py-2.5 pr-4 font-medium text-right">Compras del mes</th>
                    <th className="py-2.5 pr-4 font-medium text-right">Total del mes</th>
                    <th className="py-2.5 pr-4 font-medium">Última compra</th>
                    <th className="py-2.5 font-medium text-right">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {data.proveedores.map((p) => (
                    <tr key={p.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-3 pr-4 font-medium text-slate-800">{p.nombre}</td>
                      <td className="py-3 pr-4 font-mono text-xs text-slate-500">{p.ruc ?? "—"}</td>
                      <td className="py-3 pr-4 text-slate-600">{p.telefono ?? "—"}</td>
                      <td className="py-3 pr-4 text-right tabular-nums text-slate-700">{p.cantidad}</td>
                      <td className="py-3 pr-4 text-right tabular-nums font-semibold text-slate-800">{formatGs(p.total)}</td>
                      <td className="py-3 pr-4 text-slate-600 text-xs tabular-nums">{formatFecha(p.ultima_compra)}</td>
                      <td className="py-3 text-right">
                        <Link href={`/proveedores/${p.id}/editar`} className="text-sm font-medium text-[#3F8E91] hover:text-[#2F6F72] hover:underline">Ver proveedor</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
