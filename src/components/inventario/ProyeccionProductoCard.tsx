"use client";

import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { getProyeccionProducto, type ProyeccionProducto } from "@/lib/reportes/storage";
import { ESTADO_STOCK_LABEL, type EstadoStock } from "@/lib/reportes/proyeccion";

const ESTADO_BADGE: Record<EstadoStock, string> = {
  sin_stock: "bg-red-200 text-red-800",
  sin_movimiento: "bg-slate-200 text-slate-600",
  critico: "bg-red-100 text-red-700",
  bajo: "bg-amber-100 text-amber-700",
  normal: "bg-emerald-100 text-emerald-700",
  sobrestock: "bg-sky-100 text-sky-700",
};
const DIAS = [30, 60, 90];

function fmt(v: number, dec = 0) {
  return v.toLocaleString("es-PY", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fechaQuiebre(dias: number | null): string {
  if (dias == null || !isFinite(dias)) return "—";
  const d = new Date();
  d.setDate(d.getDate() + Math.round(dias));
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/** Proyección de cobertura de stock (días) para un producto, en el detalle. */
export default function ProyeccionProductoCard({ productoId }: { productoId: string }) {
  const [dias, setDias] = useState(30);
  const [data, setData] = useState<ProyeccionProducto | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!productoId) return;
    let cancel = false;
    setCargando(true);
    getProyeccionProducto(productoId, dias).then((d) => {
      if (!cancel) { setData(d); setCargando(false); }
    });
    return () => { cancel = true; };
  }, [productoId, dias]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-[#4FAEB2]/10 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <CalendarClock className="h-4 w-4 text-[#4FAEB2]" />
          Proyección de inventario
        </h3>
        <div className="flex items-center gap-1">
          {DIAS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDias(d)}
              className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                dias === d ? "border-[#4FAEB2] bg-[#4FAEB2] text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {cargando && !data ? (
        <p className="py-3 text-center text-xs text-slate-400 animate-pulse">Cargando…</p>
      ) : !data ? (
        <p className="py-3 text-center text-xs text-slate-400">Sin datos de proyección.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Vendido ({data.dias}d)</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{fmt(data.cantidad_vendida)}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Prom./día</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{data.promedio_diario > 0 ? fmt(data.promedio_diario, 2) : "—"}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Días de cobertura</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums text-[#3F8E91]">{data.dias_cobertura == null ? "—" : fmt(data.dias_cobertura, 1)}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Quiebre est.</p>
              <p className="mt-0.5 text-sm font-bold tabular-nums text-slate-700">
                {data.estado === "sin_movimiento" || data.estado === "sin_stock" ? "—" : fechaQuiebre(data.dias_cobertura)}
              </p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[11px] text-slate-400">Estado:</span>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${ESTADO_BADGE[data.estado]}`}>
              {ESTADO_STOCK_LABEL[data.estado]}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
