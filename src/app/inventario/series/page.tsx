"use client";

/**
 * Consulta de números de serie.
 *
 * Buscás por número de serie o producto y ves toda la historia de cada unidad:
 * estado, proveedor de origen, ubicación, cliente y garantía. Es la pantalla que
 * responde "este equipo averiado, ¿de qué proveedor vino?".
 */
import Link from "next/link";
import { Fragment, useCallback, useEffect, useState } from "react";
import {
  getSeries, SERIE_ESTADO_LABEL,
  type Serie, type SerieEstado,
} from "@/lib/inventario/series";

const inputClass =
  "w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#0EA5E9] outline-none";

const ESTADO_BADGE: Record<SerieEstado, string> = {
  en_stock:            "bg-emerald-50 text-emerald-700 border-emerald-200",
  reservado:           "bg-amber-50 text-amber-700 border-amber-200",
  vendido:             "bg-slate-100 text-slate-600 border-slate-200",
  averiado:            "bg-rose-50 text-rose-700 border-rose-200",
  en_servicio:         "bg-sky-50 text-sky-700 border-sky-200",
  devuelto_proveedor:  "bg-violet-50 text-violet-700 border-violet-200",
  baja:                "bg-slate-100 text-slate-400 border-slate-200",
};

const ESTADOS: SerieEstado[] = [
  "en_stock", "reservado", "vendido", "averiado", "en_servicio", "devuelto_proveedor", "baja",
];

function fmtFecha(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("es-PY");
}

export default function SeriesPage() {
  const [filas, setFilas] = useState<Serie[]>([]);
  const [cargando, setCargando] = useState(true);
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState<SerieEstado | "">("");
  const [expandida, setExpandida] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setCargando(true);
    setFilas(await getSeries({ q: q.trim() || undefined, estado: estado || undefined }));
    setCargando(false);
  }, [q, estado]);

  useEffect(() => {
    const t = setTimeout(() => { void reload(); }, 250);
    return () => clearTimeout(t);
  }, [reload]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 pb-10 sm:px-6 lg:px-8">
      <div>
        <Link href="/inventario" className="text-sm text-sky-600 hover:underline">← Inventario</Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Números de serie</h1>
        <p className="text-sm text-slate-600">
          Cada unidad con serie y su historia: origen, estado, ubicación y garantía.
          Buscá por número de serie para rastrear un equipo.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <input
          className={`${inputClass} max-w-xs`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por número de serie o producto…"
        />
        <select className={`${inputClass} w-48`} value={estado} onChange={(e) => setEstado(e.target.value as SerieEstado | "")}>
          <option value="">Todos los estados</option>
          {ESTADOS.map((e) => <option key={e} value={e}>{SERIE_ESTADO_LABEL[e]}</option>)}
        </select>
        <span className="ml-auto text-xs text-slate-500">{filas.length} unidades</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-slate-600">
              <th className="px-4 py-3 font-semibold">Nº de serie</th>
              <th className="px-4 py-3 font-semibold">Producto</th>
              <th className="px-4 py-3 font-semibold">Estado</th>
              <th className="px-4 py-3 font-semibold">Proveedor de origen</th>
              <th className="px-4 py-3 font-semibold">Ubicación</th>
              <th className="px-4 py-3 font-semibold">Ingreso</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((s) => (
              <Fragment key={s.id}>
                <tr
                  className="cursor-pointer border-b border-slate-50 hover:bg-slate-50/60"
                  onClick={() => setExpandida(expandida === s.id ? null : s.id)}
                >
                  <td className="px-4 py-3 font-mono font-medium text-slate-900">{s.numero_serie}</td>
                  <td className="px-4 py-3">{s.producto_nombre ?? "—"}<span className="ml-1 text-xs text-slate-400">{s.sku ?? ""}</span></td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-md border px-2 py-0.5 text-xs font-semibold ${ESTADO_BADGE[s.estado]}`}>
                      {SERIE_ESTADO_LABEL[s.estado]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{s.proveedor_nombre ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{s.ubicacion_nombre ?? "—"}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-500">{fmtFecha(s.fecha_ingreso)}</td>
                </tr>
                {expandida === s.id && (
                  <tr className="border-b border-slate-100 bg-slate-50/40">
                    <td colSpan={6} className="px-4 py-4">
                      <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-xs sm:grid-cols-4">
                        <Dato k="Cliente" v={s.cliente_nombre} />
                        <Dato k="Fecha de venta" v={fmtFecha(s.fecha_venta)} />
                        <Dato k="Precio de venta" v={s.precio_venta != null ? `Gs. ${Number(s.precio_venta).toLocaleString("es-PY")}` : "—"} />
                        <Dato k="Garantía hasta" v={fmtFecha(s.garantia_hasta)} />
                        <Dato k="Costo" v={s.costo_unitario != null ? `Gs. ${Number(s.costo_unitario).toLocaleString("es-PY")}` : "—"} />
                        <Dato k="Observaciones" v={s.observaciones} full />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {!cargando && filas.length === 0 && (
          <p className="py-10 text-center text-slate-400">
            No hay unidades con serie{q || estado ? " para ese filtro" : " todavía"}.
          </p>
        )}
        {cargando && <p className="py-10 text-center text-slate-400">Cargando…</p>}
      </div>
    </div>
  );
}

function Dato({ k, v, full = false }: { k: string; v: string | null; full?: boolean }) {
  return (
    <div className={full ? "col-span-2 sm:col-span-4" : ""}>
      <span className="block font-semibold uppercase tracking-wide text-slate-400">{k}</span>
      <span className="text-slate-700">{v || "—"}</span>
    </div>
  );
}
