"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getOrdenesCompra } from "@/lib/ordenes-compra/storage";
import { productoMatchesQuery } from "@/lib/productos/token-search";
import type { OrdenCompra } from "@/lib/ordenes-compra/types";

function fmtGs(v: number) {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}
function fmtFecha(iso: string) {
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  } catch {
    return iso;
  }
}

interface Grupo {
  numero_oc: string;
  proveedor_nombre: string;
  fecha: string;
  estado: "pendiente" | "recibida_parcial";
  items: number;
  totalPendiente: number;
}

export default function DesdeOrdenListaPage() {
  const [ordenes, setOrdenes] = useState<OrdenCompra[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");

  useEffect(() => {
    getOrdenesCompra().then((o) => { setOrdenes(o); setCargando(false); });
  }, []);

  const grupos = useMemo<Grupo[]>(() => {
    const map = new Map<string, Grupo>();
    for (const o of ordenes) {
      if (o.estado !== "pendiente" && o.estado !== "recibida_parcial") continue;
      const g = map.get(o.numero_oc);
      const pendienteLinea = o.cantidad_pendiente * o.costo_unitario;
      if (g) {
        g.items += 1;
        g.totalPendiente += pendienteLinea;
      } else {
        map.set(o.numero_oc, {
          numero_oc: o.numero_oc,
          proveedor_nombre: o.proveedor_nombre,
          fecha: o.fecha,
          estado: o.estado,
          items: 1,
          totalPendiente: pendienteLinea,
        });
      }
    }
    return [...map.values()].sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  }, [ordenes]);

  const filtrados = useMemo(() => {
    if (!busqueda.trim()) return grupos;
    return grupos.filter((g) => productoMatchesQuery(busqueda, g.numero_oc, g.proveedor_nombre));
  }, [grupos, busqueda]);

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-[#4FAEB2]"
            style={{ boxShadow: "0 0 0 3px rgba(79, 174, 178, 0.18)" }} />
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">Zentra · Adquisiciones</p>
        </div>
        <h1 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">Compra desde Orden de Compra</h1>
        <p className="mt-0.5 text-xs text-slate-500">
          Elegí la orden a recibir. Solo se muestran las que tienen algo pendiente de recibir.
        </p>
      </div>

      <Link href="/compras" className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-[#3F8E91]">
        ← Compras
      </Link>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-[#4FAEB2]/15 sm:p-5 lg:p-6">
        <div className="mb-5 flex flex-wrap items-center gap-3 border-b border-slate-100 pb-5">
          <input
            type="text"
            placeholder="Buscar por N° OC o proveedor…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#4FAEB2]/30 sm:min-w-72"
          />
          <span className="ml-auto text-sm text-slate-400">{filtrados.length} orden(es) con pendiente</span>
        </div>

        {cargando ? (
          <p className="py-8 text-center text-slate-500 animate-pulse">Cargando…</p>
        ) : filtrados.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">
            No hay órdenes de compra pendientes o parcialmente recibidas.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="border-b-2 border-[#4FAEB2]/40 bg-[#E5F4F4]">
                <tr>
                  {["N° OC", "Fecha", "Proveedor", "Ítems", "Estado", "Pendiente (Gs.)", ""].map((h, i) => (
                    <th key={h} className={`px-3 py-3 text-xs font-bold uppercase tracking-wide text-[#3F8E91] ${i === 3 || i === 5 ? "text-right" : i === 4 || i === 6 ? "text-center" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtrados.map((g) => (
                  <tr key={g.numero_oc} className="transition-colors hover:bg-[#4FAEB2]/5">
                    <td className="px-3 py-2.5 font-mono text-xs font-semibold text-[#3F8E91]">{g.numero_oc}</td>
                    <td className="px-3 py-2.5 text-xs tabular-nums text-slate-600">{fmtFecha(g.fecha)}</td>
                    <td className="px-3 py-2.5 text-xs font-medium text-slate-800">{g.proveedor_nombre || "—"}</td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-600">{g.items}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${g.estado === "pendiente" ? "bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]" : "bg-sky-100 text-sky-700"}`}>
                        {g.estado === "pendiente" ? "Pendiente" : "Recibida parcial"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums font-bold text-slate-900">{fmtGs(g.totalPendiente)}</td>
                    <td className="px-3 py-2.5 text-center">
                      <Link href={`/compras/desde-orden/${encodeURIComponent(g.numero_oc)}`}
                        className="text-xs font-semibold text-[#3F8E91] hover:underline">Recibir →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
