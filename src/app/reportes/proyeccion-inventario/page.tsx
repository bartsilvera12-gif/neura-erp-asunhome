"use client";

import { useEffect, useRef, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import { getProyeccionInventario, type ProyeccionInventario } from "@/lib/reportes/storage";
import { ESTADO_STOCK_LABEL, PROYECCION_CONFIG, type EstadoStock } from "@/lib/reportes/proyeccion";
import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from "lucide-react";

function fmtNum(v: number, dec = 0) {
  return v.toLocaleString("es-PY", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtFecha(d: Date) {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}
/** Fecha estimada de quiebre = hoy + días de cobertura. */
function fechaQuiebre(dias: number | null): string {
  if (dias == null || !isFinite(dias)) return "—";
  const d = new Date();
  d.setDate(d.getDate() + Math.round(dias));
  return fmtFecha(d);
}

const ESTADO_BADGE: Record<EstadoStock, string> = {
  sin_stock: "bg-red-200 text-red-800",
  sin_movimiento: "bg-slate-200 text-slate-600",
  critico: "bg-red-100 text-red-700",
  bajo: "bg-amber-100 text-amber-700",
  normal: "bg-emerald-100 text-emerald-700",
  sobrestock: "bg-sky-100 text-sky-700",
};

// Rangos de días de cobertura por estado, derivados de los umbrales reales.
const ESTADO_HINT: Record<EstadoStock, string> = {
  critico: `0–${PROYECCION_CONFIG.critico} días`,
  bajo: `${PROYECCION_CONFIG.critico + 1}–${PROYECCION_CONFIG.bajo} días`,
  normal: `${PROYECCION_CONFIG.bajo + 1}–${PROYECCION_CONFIG.normal} días`,
  sobrestock: `más de ${PROYECCION_CONFIG.normal} días`,
  sin_movimiento: "sin ventas",
  sin_stock: "stock en 0",
};

const DIAS_OPCIONES = [30, 60, 90];
const PAGE_SIZES = [25, 50, 100, 200] as const;
const ESTADO_FILTROS: (EstadoStock | "")[] = ["", "critico", "bajo", "normal", "sobrestock", "sin_movimiento", "sin_stock"];

export default function ProyeccionInventarioPage() {
  const [dias, setDias] = useState(30);
  const [data, setData] = useState<ProyeccionInventario | null>(null);
  const [cargando, setCargando] = useState(true);
  const [estado, setEstado] = useState<EstadoStock | "">("");
  const [busquedaDraft, setBusquedaDraft] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { setBusqueda(busquedaDraft.trim()); setPage(1); }, 350);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [busquedaDraft]);

  useEffect(() => { setPage(1); }, [dias, estado, pageSize]);

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    getProyeccionInventario({ dias, page, pageSize, estado, q: busqueda }).then((d) => {
      if (!cancel) { setData(d); setCargando(false); }
    });
    return () => { cancel = true; };
  }, [dias, page, pageSize, estado, busqueda]);

  const t = data?.totales;
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const fromIdx = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const toIdx = Math.min(safePage * pageSize, total);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Zentra · Reportes"
        title="Proyección de inventario"
        description="Cuántos días dura el stock actual según el ritmo de venta histórico."
        backHref="/reportes"
        backLabel="Reportes"
        actions={
          <div className="flex items-center gap-2">
            {DIAS_OPCIONES.map((d) => (
              <button
                key={d}
                onClick={() => setDias(d)}
                className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                  dias === d ? "border-[#4FAEB2] bg-[#4FAEB2] text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                Últimos {d} días
              </button>
            ))}
          </div>
        }
      />

      {!data && cargando ? (
        <p className="text-slate-500 animate-pulse">Cargando…</p>
      ) : !data || !t ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-slate-500 shadow-sm">
          No se pudo calcular la proyección de inventario.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
            <button onClick={() => setEstado("")} className={`rounded-xl border p-3 text-left transition-colors ${estado === "" ? "border-[#4FAEB2] bg-[#4FAEB2]/5" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Productos</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-[#3F8E91]">{fmtNum(t.total)}</p>
              <p className="mt-0.5 text-[11px] text-slate-400">últimos {data.dias} días</p>
            </button>
            {(["critico", "bajo", "normal", "sobrestock", "sin_movimiento"] as EstadoStock[]).map((e) => (
              <button key={e} onClick={() => setEstado(estado === e ? "" : e)} className={`rounded-xl border p-3 text-left transition-colors ${estado === e ? "border-[#4FAEB2] bg-[#4FAEB2]/5" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{ESTADO_STOCK_LABEL[e]}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{fmtNum(t[e])}</p>
                <p className="mt-0.5 text-[11px] text-slate-400">{ESTADO_HINT[e]}</p>
              </button>
            ))}
          </div>

          <div className="rounded-2xl border border-[#4FAEB2]/30 bg-white p-6 shadow-sm ring-1 ring-[#4FAEB2]/10">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <input
                type="text"
                placeholder="Buscar por nombre o SKU…"
                value={busquedaDraft}
                onChange={(e) => setBusquedaDraft(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#4FAEB2]/30 sm:min-w-72"
              />
              <select
                value={estado}
                onChange={(e) => setEstado(e.target.value as EstadoStock | "")}
                className="w-44 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#4FAEB2]/30"
              >
                {ESTADO_FILTROS.map((e) => (
                  <option key={e || "todos"} value={e}>{e === "" ? "Todos los estados" : ESTADO_STOCK_LABEL[e]}</option>
                ))}
              </select>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="w-28 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#4FAEB2]/30"
              >
                {PAGE_SIZES.map((n) => (<option key={n} value={n}>{n} / pág.</option>))}
              </select>
              <span className="ml-auto text-sm text-slate-400 tabular-nums">
                {cargando ? "…" : `${fromIdx}–${toIdx} de ${fmtNum(total)}`}
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[1000px] text-sm">
                <thead className="border-b-2 border-[#4FAEB2]/40 bg-[#E5F4F4]">
                  <tr>
                    <th className="px-3 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#3F8E91]">Producto</th>
                    <th className="px-3 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#3F8E91]">SKU</th>
                    <th className="px-3 py-3 text-right text-xs font-bold uppercase tracking-wide text-[#3F8E91]">Stock</th>
                    <th className="px-3 py-3 text-right text-xs font-bold uppercase tracking-wide text-[#3F8E91]">Stock mín.</th>
                    <th className="px-3 py-3 text-right text-xs font-bold uppercase tracking-wide text-[#3F8E91]">Vendido ({data.dias}d)</th>
                    <th className="px-3 py-3 text-right text-xs font-bold uppercase tracking-wide text-[#3F8E91]">Prom./día</th>
                    <th className="px-3 py-3 text-right text-xs font-bold uppercase tracking-wide text-[#3F8E91]">Días cob.</th>
                    <th className="px-3 py-3 text-right text-xs font-bold uppercase tracking-wide text-[#3F8E91]">Quiebre est.</th>
                    <th className="px-3 py-3 text-center text-xs font-bold uppercase tracking-wide text-[#3F8E91]">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.productos.length === 0 ? (
                    <tr><td colSpan={9} className="py-8 text-center text-sm text-slate-400">Sin productos para el filtro.</td></tr>
                  ) : data.productos.map((p) => (
                    <tr key={p.producto_id} className="transition-colors hover:bg-[#4FAEB2]/5">
                      <td className="px-3 py-2.5 text-xs font-semibold text-slate-900">{p.nombre}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-slate-500">{p.sku ?? "—"}</td>
                      <td className={`px-3 py-2.5 text-right text-xs tabular-nums font-medium ${p.stock_actual <= p.stock_minimo ? "text-red-600" : "text-slate-700"}`}>{fmtNum(p.stock_actual)}</td>
                      <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-500">{fmtNum(p.stock_minimo)}</td>
                      <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-700">{fmtNum(p.cantidad_vendida)}</td>
                      <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-600">{p.promedio_diario > 0 ? fmtNum(p.promedio_diario, 2) : "—"}</td>
                      <td className="px-3 py-2.5 text-right text-xs tabular-nums font-bold text-slate-900">{p.dias_cobertura == null ? "—" : fmtNum(p.dias_cobertura, 1)}</td>
                      <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-600">{p.estado === "sin_movimiento" || p.estado === "sin_stock" ? "—" : fechaQuiebre(p.dias_cobertura)}</td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${ESTADO_BADGE[p.estado]}`}>
                          {ESTADO_STOCK_LABEL[p.estado]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <span className="text-xs text-slate-500 tabular-nums">Página {safePage} de {totalPages}</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(1)} disabled={safePage <= 1} className="rounded-md border border-slate-200 p-1.5 text-slate-500 disabled:opacity-40 hover:bg-slate-50"><ChevronsLeft className="h-4 w-4" /></button>
                <button onClick={() => setPage((n) => Math.max(1, n - 1))} disabled={safePage <= 1} className="rounded-md border border-slate-200 p-1.5 text-slate-500 disabled:opacity-40 hover:bg-slate-50"><ChevronLeft className="h-4 w-4" /></button>
                <button onClick={() => setPage((n) => Math.min(totalPages, n + 1))} disabled={safePage >= totalPages} className="rounded-md border border-slate-200 p-1.5 text-slate-500 disabled:opacity-40 hover:bg-slate-50"><ChevronRight className="h-4 w-4" /></button>
                <button onClick={() => setPage(totalPages)} disabled={safePage >= totalPages} className="rounded-md border border-slate-200 p-1.5 text-slate-500 disabled:opacity-40 hover:bg-slate-50"><ChevronsRight className="h-4 w-4" /></button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
