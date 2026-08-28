"use client";

/** Reporte diario por fecha: una fila por día con ventas y total (y medios de pago). */
import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import RangoFechasSelector from "@/components/reportes/RangoFechasSelector";
import ExportExcelButton from "@/components/ui/ExportExcelButton";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { mesActualAsuncion } from "@/lib/fechas/asuncion-bounds";

type Dia = { dia: string; ventas: number; total: number; efectivo: number; tarjeta: number; transferencia: number };
type DetalleLinea = {
  fecha: string; numero_control: string; numero_factura: string | null; cliente: string | null;
  metodo_pago: string | null; producto: string; cantidad: number; precio_venta: number; total: number;
};
type Reporte = {
  desde: string; hasta: string;
  por_dia: Dia[];
  totales: { ventas: number; total: number; efectivo: number; tarjeta: number; transferencia: number };
  detalle: DetalleLinea[];
};

const PAGO_LBL: Record<string, string> = {
  efectivo: "Efectivo", tarjeta: "Tarjeta", transferencia: "Transfer.", mixto: "Mixto",
};

function formatGs(v: number) {
  return `Gs. ${Math.round(v || 0).toLocaleString("es-PY")}`;
}
function fFecha(ymd: string) {
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}
function hoy() {
  return new Date().toISOString().slice(0, 10);
}

export default function ReporteDiarioPage() {
  const [desde, setDesde] = useState(`${mesActualAsuncion()}-01`);
  const [hasta, setHasta] = useState(hoy());
  const [data, setData] = useState<Reporte | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await fetchWithSupabaseSession(`/api/reportes/diario?desde=${desde}&hasta=${hasta}`, { cache: "no-store" });
      const j = await r.json();
      setData(j?.data ?? null);
    } catch {
      setData(null);
    } finally {
      setCargando(false);
    }
  }, [desde, hasta]);

  useEffect(() => { void cargar(); }, [cargar]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Reportes"
        title="Ventas por día"
        description="Total vendido por fecha, en el rango elegido"
        backHref="/reportes"
        backLabel="Reportes"
        actions={
          <div className="flex items-center gap-3">
            <RangoFechasSelector desde={desde} hasta={hasta} onChange={(r) => { setDesde(r.desde); setHasta(r.hasta); }} />
            <ExportExcelButton url={`/api/reportes/diario/export?desde=${desde}&hasta=${hasta}`} />
          </div>
        }
      />

      {cargando ? (
        <p className="text-slate-500 animate-pulse">Cargando…</p>
      ) : !data ? (
        <p className="text-slate-500">No se pudo cargar el reporte.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard compact label="Días con ventas" value={String(data.por_dia.length)} />
            <StatCard compact label="Ventas" value={String(data.totales.ventas)} />
            <StatCard compact accent label="Total vendido" value={formatGs(data.totales.total)} />
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Fecha</th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Ventas</th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Efectivo</th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Tarjeta</th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Transfer.</th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Total del día</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.por_dia.length === 0 ? (
                    <tr><td colSpan={6} className="py-10 text-center text-sm text-slate-400">Sin ventas en el rango.</td></tr>
                  ) : (
                    data.por_dia.map((d) => (
                      <tr key={d.dia} className="hover:bg-slate-50/50">
                        <td className="px-4 py-2.5 font-medium text-slate-800">{fFecha(d.dia)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{d.ventas}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{formatGs(d.efectivo)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{formatGs(d.tarjeta)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{formatGs(d.transferencia)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-900">{formatGs(d.total)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                {data.por_dia.length > 0 && (
                  <tfoot className="border-t border-slate-200 bg-slate-50">
                    <tr>
                      <td className="px-4 py-3 text-sm font-bold text-slate-700">Total</td>
                      <td className="px-4 py-3 text-right text-sm font-bold tabular-nums text-slate-700">{data.totales.ventas}</td>
                      <td className="px-4 py-3 text-right text-sm font-bold tabular-nums text-slate-500">{formatGs(data.totales.efectivo)}</td>
                      <td className="px-4 py-3 text-right text-sm font-bold tabular-nums text-slate-500">{formatGs(data.totales.tarjeta)}</td>
                      <td className="px-4 py-3 text-right text-sm font-bold tabular-nums text-slate-500">{formatGs(data.totales.transferencia)}</td>
                      <td className="px-4 py-3 text-right text-sm font-bold tabular-nums text-slate-900">{formatGs(data.totales.total)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
          <p className="text-xs text-slate-400">Excluye ventas anuladas y devueltas. El desglose por medio de pago no incluye pagos mixtos (se ven en Reportes → Cajas).</p>

          {/* Detalle por producto (todos los movimientos del rango) */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-700">Detalle por producto</h2>
              <p className="text-[11px] text-slate-500">Cada producto vendido en el rango: cantidad, precio, importe, medio de pago y venta.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Fecha</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Venta</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Producto</th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Cant.</th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Precio unit.</th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Importe</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Pago</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(data.detalle ?? []).length === 0 ? (
                    <tr><td colSpan={7} className="py-8 text-center text-sm text-slate-400">Sin movimientos en el rango.</td></tr>
                  ) : (
                    data.detalle.map((l, i) => (
                      <tr key={`${l.numero_control}-${i}`} className="hover:bg-slate-50/50">
                        <td className="px-4 py-2 text-slate-600 whitespace-nowrap">{l.fecha}</td>
                        <td className="px-4 py-2 font-mono text-xs text-slate-500 whitespace-nowrap">{l.numero_factura || l.numero_control}</td>
                        <td className="px-4 py-2 text-slate-800">{l.producto}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-600">{l.cantidad}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-600">{formatGs(l.precio_venta)}</td>
                        <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-900">{formatGs(l.total)}</td>
                        <td className="px-4 py-2 text-slate-500">{l.metodo_pago ? (PAGO_LBL[l.metodo_pago] ?? l.metodo_pago) : "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                {data.detalle.length > 0 && (
                  <tfoot className="border-t border-slate-200 bg-slate-50">
                    <tr>
                      <td colSpan={5} className="px-4 py-3 text-right text-sm font-bold text-slate-700">Total general vendido</td>
                      <td className="px-4 py-3 text-right text-sm font-bold tabular-nums text-slate-900">{formatGs(data.totales.total)}</td>
                      <td />
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
