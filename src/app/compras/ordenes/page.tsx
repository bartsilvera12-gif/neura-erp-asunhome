"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getOrdenesCompra, deleteOrdenCompra } from "@/lib/ordenes-compra/storage";
import { productoMatchesQuery } from "@/lib/productos/token-search";
import type { OrdenCompra, EstadoOrdenCompra } from "@/lib/ordenes-compra/types";

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

const ESTADO_BADGE: Record<EstadoOrdenCompra, string> = {
  pendiente: "bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]",
  recibida_parcial: "bg-sky-100 text-sky-700",
  recibida_total: "bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]",
  cancelada: "bg-slate-100 text-slate-500",
};
const ESTADO_LBL: Record<EstadoOrdenCompra, string> = {
  pendiente: "Pendiente",
  recibida_parcial: "Recibida parcial",
  recibida_total: "Recibida total",
  cancelada: "Cancelada",
};

interface Grupo {
  numero_oc: string;
  proveedor_nombre: string;
  estado: EstadoOrdenCompra;
  fecha: string;
  items: number;
  total: number;
}

export default function OrdenesCompraPage() {
  const [ordenes, setOrdenes] = useState<OrdenCompra[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState<EstadoOrdenCompra | "">("");
  const [anularTarget, setAnularTarget] = useState<Grupo | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    getOrdenesCompra().then((o) => { setOrdenes(o); setCargando(false); });
  }, [reloadKey]);

  const grupos = useMemo<Grupo[]>(() => {
    const map = new Map<string, Grupo>();
    for (const o of ordenes) {
      const g = map.get(o.numero_oc);
      if (g) {
        g.items += 1;
        g.total += o.total;
      } else {
        map.set(o.numero_oc, {
          numero_oc: o.numero_oc,
          proveedor_nombre: o.proveedor_nombre,
          estado: o.estado,
          fecha: o.fecha,
          items: 1,
          total: o.total,
        });
      }
    }
    return [...map.values()].sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  }, [ordenes]);

  const filtrados = useMemo(() => {
    return grupos.filter((g) => {
      if (filtroEstado && g.estado !== filtroEstado) return false;
      return productoMatchesQuery(busqueda, g.numero_oc, g.proveedor_nombre);
    });
  }, [grupos, busqueda, filtroEstado]);

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-[#4FAEB2]"
            style={{ boxShadow: "0 0 0 3px rgba(79, 174, 178, 0.18)" }} />
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">Zentra · Adquisiciones</p>
        </div>
        <h1 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">Compras</h1>
        <p className="mt-0.5 text-xs text-slate-500">Órdenes de compra a proveedores (sin factura, sin impacto en stock)</p>
      </div>

      {/* Navegación */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        <Link href="/compras" className="border-b-2 border-transparent px-4 py-2 text-sm font-medium text-slate-500 transition-colors hover:text-[#3F8E91]">
          Compras
        </Link>
        <span className="border-b-2 border-[#4FAEB2] px-4 py-2 text-sm font-semibold text-[#3F8E91]">
          Órdenes de compra
        </span>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-[#4FAEB2]/15 sm:p-5 lg:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Órdenes de compra</h2>
          <Link href="/compras/ordenes/nueva"
            className="rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-[#4FAEB2]/25 transition-colors hover:bg-[#3F8E91] active:scale-95">
            + Nueva orden de compra
          </Link>
        </div>

        {/* Filtros */}
        <div className="mb-5 flex flex-wrap items-center gap-3 border-b border-slate-100 pb-5">
          <input type="text" placeholder="Buscar por N° OC o proveedor…"
            value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#4FAEB2]/30 sm:min-w-72" />
          <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value as EstadoOrdenCompra | "")}
            className="w-44 rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-[#4FAEB2]/30">
            <option value="">Todos los estados</option>
            <option value="pendiente">Pendientes</option>
            <option value="recibida_parcial">Recibidas parcial</option>
            <option value="recibida_total">Recibidas total</option>
            <option value="cancelada">Canceladas</option>
          </select>
          <span className="ml-auto text-sm text-slate-400">{filtrados.length} de {grupos.length} órdenes</span>
        </div>

        {cargando ? (
          <p className="py-8 text-center text-slate-500 animate-pulse">Cargando…</p>
        ) : filtrados.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">No hay órdenes de compra. Creá la primera con “+ Nueva orden de compra”.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b-2 border-[#4FAEB2]/40 bg-[#E5F4F4]">
                <tr>
                  {["N° OC", "Fecha", "Proveedor", "Ítems", "Total", "Estado", ""].map((h, i) => (
                    <th key={h} className={`px-3 py-3 text-xs font-bold uppercase tracking-wide text-[#3F8E91] ${i === 3 || i === 4 ? "text-right" : i === 5 || i === 6 ? "text-center" : "text-left"}`}>{h}</th>
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
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums font-bold text-slate-900">{fmtGs(g.total)}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${ESTADO_BADGE[g.estado]}`}>
                        {ESTADO_LBL[g.estado]}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <div className="inline-flex items-center gap-3">
                        <Link href={`/compras/ordenes/${encodeURIComponent(g.numero_oc)}`}
                          className="text-xs font-semibold text-[#3F8E91] hover:underline">Ver</Link>
                        {(g.estado === "pendiente" || g.estado === "recibida_parcial") && (
                          <Link href={`/compras/desde-orden/${encodeURIComponent(g.numero_oc)}`}
                            className="text-xs font-semibold text-emerald-700 hover:underline">Recibir</Link>
                        )}
                        {g.estado === "pendiente" && (
                          <>
                            <Link
                              href={`/compras/ordenes/${encodeURIComponent(g.numero_oc)}/editar`}
                              className="text-xs font-semibold text-slate-600 hover:underline"
                              title="Editar productos y condiciones"
                            >
                              Editar
                            </Link>
                            <button
                              type="button"
                              onClick={async () => {
                                if (!confirm(`¿Eliminar la orden ${g.numero_oc}? Esta acción no se puede deshacer.`)) return;
                                const r = await deleteOrdenCompra(g.numero_oc);
                                if (!r.success) { alert(r.error); return; }
                                setReloadKey((k) => k + 1);
                              }}
                              className="text-xs font-semibold text-red-700 hover:underline"
                              title="Eliminar OC (solo pendientes)"
                            >
                              Eliminar
                            </button>
                          </>
                        )}
                        {g.estado !== "cancelada" && g.estado !== "pendiente" && (
                          <button
                            type="button"
                            onClick={() => setAnularTarget(g)}
                            className="text-xs font-semibold text-red-700 hover:underline"
                            title="Anular orden y revertir stock/movimientos"
                          >
                            Anular
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {anularTarget && (
        <AnularOcModal
          orden={anularTarget}
          onClose={() => setAnularTarget(null)}
          onDone={() => { setAnularTarget(null); setReloadKey((k) => k + 1); }}
        />
      )}
    </div>
  );
}

function AnularOcModal({
  orden,
  onClose,
  onDone,
}: {
  orden: Grupo;
  onClose: () => void;
  onDone: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/ordenes-compra/${encodeURIComponent(orden.numero_oc)}/anular`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ motivo: motivo.trim() || null }),
        }
      );
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? `Error ${res.status}`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo anular.");
    } finally {
      setLoading(false);
    }
  }

  const yaRecibida = orden.estado === "recibida_parcial" || orden.estado === "recibida_total";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border-2 border-red-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-red-100 bg-red-50/60 px-5 py-4">
          <h3 className="text-base font-bold text-red-800">Anular OC {orden.numero_oc}</h3>
          <p className="mt-1 text-xs text-red-700">
            {yaRecibida
              ? "Esta OC ya tiene mercadería recibida. Se va a REVERTIR el stock ingresado y crear contra-movimientos en Inventario. Los reportes van a excluir estas compras."
              : "Se marca la OC como cancelada. No hay stock recibido para revertir."}
            {" "}Esta acción no se puede deshacer.
          </p>
        </div>
        <div className="p-5 space-y-3">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Motivo (opcional)</span>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej: proveedor no cumplió, error de carga, mercadería devuelta…"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-red-400 focus:ring-2 focus:ring-red-200 outline-none"
              rows={3}
              disabled={loading}
            />
          </label>
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={loading}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {loading ? "Anulando..." : "Anular OC"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
