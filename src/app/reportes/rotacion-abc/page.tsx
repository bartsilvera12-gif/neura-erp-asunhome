"use client";

import { useEffect, useRef, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import { getRotacionAbcReporte, type RotacionAbc } from "@/lib/reportes/storage";
import type { RangoABC } from "@/lib/reportes/abc";
import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, Boxes, TrendingUp, BarChart3, TrendingDown } from "lucide-react";

function fmtGs(v: number) {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}
function fmtNum(v: number) {
  return v.toLocaleString("es-PY");
}

const RANGO_BADGE: Record<RangoABC, string> = {
  A: "bg-emerald-100 text-emerald-700",
  B: "bg-amber-100 text-amber-700",
  C: "bg-slate-200 text-slate-600",
};

const PERIODOS = [
  { meses: 1, label: "Último mes" },
  { meses: 2, label: "Últimos 2 meses" },
  { meses: 3, label: "Últimos 3 meses" },
];
const PAGE_SIZES = [25, 50, 100, 200] as const;

export default function RotacionAbcPage() {
  const [meses, setMeses] = useState(3);
  const [data, setData] = useState<RotacionAbc | null>(null);
  const [cargando, setCargando] = useState(true);
  const [rango, setRango] = useState<RangoABC | "">("");
  const [busquedaDraft, setBusquedaDraft] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Debounce de la búsqueda (350ms) → resetea a página 1.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { setBusqueda(busquedaDraft.trim()); setPage(1); }, 350);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [busquedaDraft]);

  // Reset de página al cambiar período / rango / tamaño.
  useEffect(() => { setPage(1); }, [meses, rango, pageSize]);

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    getRotacionAbcReporte({ meses, page, pageSize, rango, q: busqueda }).then((d) => {
      if (!cancel) { setData(d); setCargando(false); }
    });
    return () => { cancel = true; };
  }, [meses, page, pageSize, rango, busqueda]);

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
        title="Rotación de productos (ABC)"
        description="Clasificación por ventas: A muy vendidos, B medios, C poca o ninguna venta."
        backHref="/reportes"
        backLabel="Reportes"
        actions={
          <div className="flex items-center gap-2">
            {PERIODOS.map((p) => (
              <button
                key={p.meses}
                onClick={() => setMeses(p.meses)}
                className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                  meses === p.meses
                    ? "border-[#4FAEB2] bg-[#4FAEB2] text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        }
      />

      {!data && cargando ? (
        <p className="text-slate-500 animate-pulse">Cargando…</p>
      ) : !data || !t ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-slate-500 shadow-sm">
          No se pudo cargar la rotación de productos.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {/* Productos (total) + distribución A/B/C */}
            <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <span className="absolute inset-x-0 top-0 h-1 bg-[#4FAEB2]" />
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Productos</p>
                  <p className="mt-1 text-3xl font-bold tabular-nums text-[#3F8E91]">{fmtNum(t.total)}</p>
                </div>
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#4FAEB2]/12 text-[#3F8E91]">
                  <Boxes className="h-5 w-5" />
                </span>
              </div>
              {t.total > 0 && (
                <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-slate-100">
                  <span className="bg-emerald-400" style={{ width: `${(t.a / t.total) * 100}%` }} />
                  <span className="bg-amber-400" style={{ width: `${(t.b / t.total) * 100}%` }} />
                  <span className="bg-slate-300" style={{ width: `${(t.c / t.total) * 100}%` }} />
                </div>
              )}
              <p className="mt-2 text-[11px] text-slate-400">período {data.desde} → {data.hasta}</p>
            </div>

            {/* Clase A / B / C */}
            {([
              { letra: "A" as const, valor: t.a, hint: "muy vendidos", chip: "bg-emerald-100 text-emerald-700", bar: "bg-emerald-400", Icon: TrendingUp },
              { letra: "B" as const, valor: t.b, hint: "medianamente vendidos", chip: "bg-amber-100 text-amber-700", bar: "bg-amber-400", Icon: BarChart3 },
              { letra: "C" as const, valor: t.c, hint: `${fmtNum(t.sin_ventas)} sin ventas`, chip: "bg-slate-200 text-slate-600", bar: "bg-slate-300", Icon: TrendingDown },
            ]).map((c) => (
              <div key={c.letra} className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
                <span className={`absolute inset-x-0 top-0 h-1 ${c.bar}`} />
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Clase {c.letra}</p>
                    <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">{fmtNum(c.valor)}</p>
                  </div>
                  <span className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${c.chip}`}>
                    <span className="text-base font-extrabold">{c.letra}</span>
                    <c.Icon className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-white p-0.5" strokeWidth={2.5} />
                  </span>
                </div>
                <p className="mt-3 text-xs text-slate-500">{c.hint}</p>
              </div>
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
                value={rango}
                onChange={(e) => setRango(e.target.value as RangoABC | "")}
                className="w-40 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#4FAEB2]/30"
              >
                <option value="">Todos los rangos</option>
                <option value="A">Rango A</option>
                <option value="B">Rango B</option>
                <option value="C">Rango C</option>
              </select>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="w-28 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#4FAEB2]/30"
                title="Ítems por página"
              >
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>{n} / pág.</option>
                ))}
              </select>
              <span className="ml-auto text-sm text-slate-400 tabular-nums">
                {cargando ? "…" : `${fromIdx}–${toIdx} de ${fmtNum(total)}`}
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[880px] text-sm">
                <thead className="border-b-2 border-[#4FAEB2]/40 bg-[#E5F4F4]">
                  <tr>
                    <th className="px-3 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#3F8E91]">Producto</th>
                    <th className="px-3 py-3 text-left text-xs font-bold uppercase tracking-wide text-[#3F8E91]">SKU</th>
                    <th className="px-3 py-3 text-right text-xs font-bold uppercase tracking-wide text-[#3F8E91]">Stock</th>
                    <th className="px-3 py-3 text-right text-xs font-bold uppercase tracking-wide text-[#3F8E91]">Stock mín.</th>
                    <th className="px-3 py-3 text-right text-xs font-bold uppercase tracking-wide text-[#3F8E91]">Cant. vendida</th>
                    <th className="px-3 py-3 text-right text-xs font-bold uppercase tracking-wide text-[#3F8E91]">Importe vendido</th>
                    <th className="px-3 py-3 text-center text-xs font-bold uppercase tracking-wide text-[#3F8E91]">Rango</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.productos.length === 0 ? (
                    <tr><td colSpan={7} className="py-8 text-center text-sm text-slate-400">Sin productos para el filtro.</td></tr>
                  ) : data.productos.map((p) => (
                    <tr key={p.producto_id} className="transition-colors hover:bg-[#4FAEB2]/5">
                      <td className="px-3 py-2.5 text-xs font-semibold text-slate-900">{p.nombre}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-slate-500">{p.sku ?? "—"}</td>
                      <td className={`px-3 py-2.5 text-right text-xs tabular-nums font-medium ${p.stock_actual <= p.stock_minimo ? "text-red-600" : "text-slate-700"}`}>{fmtNum(p.stock_actual)}</td>
                      <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-500">{fmtNum(p.stock_minimo)}</td>
                      <td className="px-3 py-2.5 text-right text-xs tabular-nums font-bold text-slate-900">{fmtNum(p.cantidad_vendida)}</td>
                      <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-700">{fmtGs(p.importe_vendido)}</td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${RANGO_BADGE[p.rango]}`}>{p.rango}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Paginación */}
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
