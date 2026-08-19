"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Eye } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import ExportExcelButton from "@/components/ui/ExportExcelButton";
import RangoFechasSelector from "@/components/reportes/RangoFechasSelector";
import { getCajasReporte } from "@/lib/reportes/storage";
import { mesActualAsuncion } from "@/lib/fechas/asuncion-bounds";
import type { CajasReporte } from "@/lib/caja/types";

function formatGs(v: number) {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}
function formatFechaHora(iso: string | null) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const fch = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
    const hh = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return `${fch} ${hh}`;
  } catch {
    return iso;
  }
}

const hoyAsuncion = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Asuncion" });

export default function CajasReportePage() {
  const [desde, setDesde] = useState(`${mesActualAsuncion()}-01`);
  const [hasta, setHasta] = useState(hoyAsuncion());
  const [data, setData] = useState<CajasReporte | null>(null);
  const [cargando, setCargando] = useState(true);
  const [filtroCaja, setFiltroCaja] = useState<number | "">("");

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    getCajasReporte(desde, hasta).then((d) => {
      if (!cancel) {
        setData(d);
        setCargando(false);
      }
    });
    return () => { cancel = true; };
  }, [desde, hasta]);

  const t = data?.totales;
  const numerosCajas = [...new Set((data?.cajas ?? []).map((c) => c.numero_caja))].sort((a, b) => a - b);
  const cajasFiltradas = (data?.cajas ?? []).filter((c) => filtroCaja === "" || c.numero_caja === filtroCaja);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Zentra · Reportes"
        title="Cierres de caja"
        description="Arqueo de turnos: apertura, cierre, efectivo esperado vs. contado y diferencias."
        backHref="/reportes"
        backLabel="Reportes"
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <RangoFechasSelector
              desde={desde}
              hasta={hasta}
              onChange={(r) => { setDesde(r.desde); setHasta(r.hasta); }}
            />
            {numerosCajas.length > 1 && (
              <select
                value={filtroCaja}
                onChange={(e) => setFiltroCaja(e.target.value === "" ? "" : Number(e.target.value))}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#4FAEB2]/30"
                aria-label="Filtrar por caja"
              >
                <option value="">Todas las cajas</option>
                {numerosCajas.map((n) => (<option key={n} value={n}>Caja {n}</option>))}
              </select>
            )}
            <ExportExcelButton url={`/api/reportes/cajas/export?desde=${desde}&hasta=${hasta}`} />
          </div>
        }
      />

      {cargando ? (
        <p className="text-slate-500 animate-pulse">Cargando…</p>
      ) : !data || !t ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-slate-500 shadow-sm">
          No se pudo cargar el reporte de caja.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard compact accent label="Cajas en el período" value={String(t.cantidad_cajas)} hint={`${t.cajas_cerradas} cerradas · ${t.cajas_abiertas} abiertas`} />
            <StatCard compact label="Total vendido" value={formatGs(t.total_vendido)} hint={`${formatGs(t.total_efectivo)} en efectivo`} />
            <StatCard compact label="Diferencia neta" value={formatGs(t.total_diferencia)} hint={`${t.cajas_con_diferencia} caja(s) con diferencia`} />
            <StatCard compact label="Faltantes / Sobrantes" value={`${formatGs(t.faltantes)} / ${formatGs(t.sobrantes)}`} hint="faltante / sobrante acumulado" />
          </div>

          <div className="rounded-2xl border border-[#4FAEB2]/30 bg-white p-6 shadow-sm ring-1 ring-[#4FAEB2]/10">
            <h2 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700">
              <span className="inline-block h-3.5 w-1 rounded-full bg-[#4FAEB2]" />
              Detalle de turnos
            </h2>
            {data.cajas.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">No hay turnos de caja en el período seleccionado.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[1100px] text-sm">
                  <thead className="border-b-2 border-[#4FAEB2]/40 bg-[#E5F4F4]">
                    <tr>
                      {["Caja", "Apertura", "Cierre", "Estado", "Abrió / Cerró", "Apertura Gs.", "Ventas", "Vendido", "Efectivo", "Esperado", "Contado", "Diferencia"].map((h, i) => (
                        <th key={h} className={`px-3 py-3 text-xs font-bold uppercase tracking-wide text-[#3F8E91] ${i >= 5 ? "text-right" : "text-left"}`}>{h}</th>
                      ))}
                      <th className="px-3 py-3 text-center text-xs font-bold uppercase tracking-wide text-[#3F8E91]">Detalle</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {cajasFiltradas.map((c) => {
                      const dif = c.diferencia;
                      const difClass = dif == null ? "text-slate-400" : dif === 0 ? "text-emerald-600" : dif < 0 ? "text-red-600" : "text-amber-600";
                      const estadoLbl = c.estado === "cerrada" ? "Cerrada" : c.estado === "en_cierre" ? "En cierre" : "Abierta";
                      const estadoCls = c.estado === "cerrada" ? "bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]" : "bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]";
                      return (
                        <tr key={c.id} className="transition-colors hover:bg-[#4FAEB2]/10">
                          <td className="px-3 py-2.5 text-xs font-bold text-[#3F8E91]">Caja {c.numero_caja}</td>
                          <td className="px-3 py-2.5 text-xs tabular-nums text-slate-700">{formatFechaHora(c.fecha_apertura)}</td>
                          <td className="px-3 py-2.5 text-xs tabular-nums text-slate-700">{formatFechaHora(c.fecha_cierre)}</td>
                          <td className="px-3 py-2.5">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${estadoCls}`}>
                              {estadoLbl}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-xs text-slate-600">
                            <span className="font-medium text-slate-800">{c.abierta_por_nombre ?? "—"}</span>
                            {c.estado === "cerrada" && (
                              <span className="text-slate-400"> → {c.cerrada_por_nombre ?? "—"}</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-600">{formatGs(c.monto_apertura)}</td>
                          <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-700">{c.cantidad_ventas}</td>
                          <td className="px-3 py-2.5 text-right text-xs tabular-nums font-semibold text-slate-900">{formatGs(c.total_vendido)}</td>
                          <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-600">{formatGs(c.total_efectivo)}</td>
                          <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-700">{formatGs(c.efectivo_esperado)}</td>
                          <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-700">{c.monto_cierre_contado == null ? "—" : formatGs(c.monto_cierre_contado)}</td>
                          <td className={`px-3 py-2.5 text-right text-xs tabular-nums font-bold ${difClass}`}>
                            {dif == null ? "—" : (dif > 0 ? "+" : "") + formatGs(dif)}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <Link
                              href={`/reportes/cajas/${c.id}`}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-[#4FAEB2]/40 bg-white px-2.5 py-1.5 text-xs font-semibold text-[#3F8E91] transition-colors hover:bg-[#4FAEB2]/10"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              Ver
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
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
