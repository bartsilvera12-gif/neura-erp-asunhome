"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import ExportExcelButton from "@/components/ui/ExportExcelButton";
import RangoFechasSelector from "@/components/reportes/RangoFechasSelector";
import { getComprasPanel } from "@/lib/reportes/storage";
import { getCompras } from "@/lib/compras/storage";
import { productoMatchesQuery } from "@/lib/productos/token-search";
import { mesActualAsuncion } from "@/lib/fechas/asuncion-bounds";
import type { ComprasPanel } from "@/lib/reportes/types";
import type { Compra } from "@/lib/compras/types";

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
const hoyAsuncion = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Asuncion" });

const ESTADO_COMPRA: Record<string, string> = {
  registrada: "Registrada",
  pendiente: "Pendiente",
  pagada: "Pagada",
  anulada: "Anulada",
};
const ESTADO_OC: Record<string, { lbl: string; cls: string }> = {
  pendiente: { lbl: "Pendiente", cls: "bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]" },
  recibida_parcial: { lbl: "Recibida parcial", cls: "bg-sky-100 text-sky-700" },
  recibida_total: { lbl: "Recibida total", cls: "bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]" },
  cancelada: { lbl: "Cancelada", cls: "bg-slate-100 text-slate-500" },
};

type Vista = "compras" | "pendientes";

export default function ComprasReportePage() {
  const [desde, setDesde] = useState(`${mesActualAsuncion()}-01`);
  const [hasta, setHasta] = useState(hoyAsuncion());
  const [data, setData] = useState<ComprasPanel | null>(null);
  const [cargando, setCargando] = useState(true);
  const [vista, setVista] = useState<Vista>("compras");

  // Filtros
  const [busqueda, setBusqueda] = useState("");
  const [filtroProveedor, setFiltroProveedor] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");

  // Detalle de una compra (modal, sin salir del reporte). Las líneas se cargan
  // una vez (getCompras devuelve las filas planas) y se filtran por numero_control.
  const [detalle, setDetalle] = useState<ComprasPanel["compras"][number] | null>(null);
  const [comprasFull, setComprasFull] = useState<Compra[] | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);

  async function abrirDetalle(c: ComprasPanel["compras"][number]) {
    setDetalle(c);
    if (comprasFull == null) {
      setCargandoDetalle(true);
      const full = await getCompras();
      setComprasFull(full);
      setCargandoDetalle(false);
    }
  }

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    getComprasPanel(desde, hasta).then((d) => {
      if (!cancel) { setData(d); setCargando(false); }
    });
    return () => { cancel = true; };
  }, [desde, hasta]);

  const t = data?.totales;

  const proveedores = useMemo(() => {
    if (!data) return [] as string[];
    const src = vista === "compras" ? data.compras : data.pendientes;
    return [...new Set(src.map((r) => r.proveedor_nombre).filter(Boolean))].sort();
  }, [data, vista]);

  const comprasFiltradas = useMemo(() => {
    if (!data) return [];
    return data.compras.filter((c) => {
      if (filtroProveedor && c.proveedor_nombre !== filtroProveedor) return false;
      if (filtroEstado && c.estado !== filtroEstado) return false;
      return productoMatchesQuery(busqueda, c.numero_control, c.numero_factura, c.proveedor_nombre);
    });
  }, [data, busqueda, filtroProveedor, filtroEstado]);

  const pendientesFiltrados = useMemo(() => {
    if (!data) return [];
    return data.pendientes.filter((p) => {
      if (filtroProveedor && p.proveedor_nombre !== filtroProveedor) return false;
      if (filtroEstado && p.estado !== filtroEstado) return false;
      return productoMatchesQuery(busqueda, p.numero_oc, p.producto_nombre, p.sku, p.proveedor_nombre);
    });
  }, [data, busqueda, filtroProveedor, filtroEstado]);

  function cambiarVista(v: Vista) {
    setVista(v);
    setFiltroProveedor("");
    setFiltroEstado("");
    setBusqueda("");
  }

  const hayFiltros = busqueda || filtroProveedor || filtroEstado;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Zentra · Reportes"
        title="Compras"
        description="Compras confirmadas y órdenes pendientes de recibir"
        backHref="/reportes"
        backLabel="Reportes"
        actions={
          <div className="flex items-center gap-3">
            <RangoFechasSelector desde={desde} hasta={hasta} onChange={(r) => { setDesde(r.desde); setHasta(r.hasta); }} />
            <ExportExcelButton url={`/api/reportes/compras-panel/export?desde=${desde}&hasta=${hasta}`} />
          </div>
        }
      />

      {/* Cards resumen del período */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard compact accent label="Compras del período" value={t ? String(t.total_compras) : "—"} />
        <StatCard compact label="Monto comprado" value={t ? formatGs(t.monto_comprado) : "—"} />
        <StatCard compact label="Órdenes pendientes" value={t ? String(t.ordenes_pendientes) : "—"} hint="con saldo por recibir" />
        <StatCard compact label="Monto pendiente estimado" value={t ? formatGs(t.monto_pendiente) : "—"} hint="al costo pactado" />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        <button
          type="button"
          onClick={() => cambiarVista("compras")}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${vista === "compras" ? "border-[#4FAEB2] text-[#3F8E91]" : "border-transparent text-slate-500 hover:text-[#3F8E91]"}`}
        >
          Todas las compras{data ? ` (${data.compras.length})` : ""}
        </button>
        <button
          type="button"
          onClick={() => cambiarVista("pendientes")}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${vista === "pendientes" ? "border-[#4FAEB2] text-[#3F8E91]" : "border-transparent text-slate-500 hover:text-[#3F8E91]"}`}
        >
          Ordenados no comprados{data ? ` (${data.pendientes.length})` : ""}
        </button>
      </div>

      {/* Filtros de la vista activa */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder={vista === "compras" ? "Buscar por N° compra, factura o proveedor…" : "Buscar por N° OC, producto, SKU o proveedor…"}
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#4FAEB2]/30 sm:min-w-72"
        />
        {proveedores.length > 1 && (
          <select value={filtroProveedor} onChange={(e) => setFiltroProveedor(e.target.value)}
            className="w-52 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#4FAEB2]/30">
            <option value="">Todos los proveedores</option>
            {proveedores.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        {vista === "pendientes" && (
          <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}
            className="w-44 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#4FAEB2]/30">
            <option value="">Pendiente + parcial</option>
            <option value="pendiente">Solo pendientes</option>
            <option value="recibida_parcial">Solo parciales</option>
          </select>
        )}
        {hayFiltros && (
          <button onClick={() => { setBusqueda(""); setFiltroProveedor(""); setFiltroEstado(""); }}
            className="text-sm text-slate-400 hover:text-slate-600 transition-colors px-2">
            Limpiar filtros
          </button>
        )}
      </div>

      {cargando ? (
        <p className="text-slate-500 animate-pulse">Cargando…</p>
      ) : !data ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-slate-500 shadow-sm">
          No se pudo cargar el reporte de compras.
        </div>
      ) : vista === "compras" ? (
        <VistaCompras filas={comprasFiltradas} onVer={abrirDetalle} />
      ) : (
        <VistaPendientes filas={pendientesFiltrados} />
      )}

      {detalle && (
        <CompraDetalleModal
          compra={detalle}
          items={(comprasFull ?? []).filter((r) => r.numero_control === detalle.numero_control)}
          cargando={cargandoDetalle}
          onClose={() => setDetalle(null)}
        />
      )}
    </div>
  );
}

function CompraDetalleModal({
  compra,
  items,
  cargando,
  onClose,
}: {
  compra: ComprasPanel["compras"][number];
  items: Compra[];
  cargando: boolean;
  onClose: () => void;
}) {
  const ivaLbl: Record<string, string> = { exenta: "Exenta", "5": "5%", "10": "10%" };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border-2 border-[#4FAEB2]/20 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent px-5 py-4">
          <div>
            <h3 className="font-mono text-sm font-bold text-[#3F8E91]">{compra.numero_control}</h3>
            <p className="mt-0.5 text-xs text-slate-500">Detalle de la compra</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Cerrar">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 py-4 sm:grid-cols-4">
          <Meta label="Fecha" value={formatFecha(compra.fecha)} />
          <Meta label="N° Factura" value={compra.numero_factura || "—"} />
          <Meta label="Proveedor" value={compra.proveedor_nombre} />
          <Meta label="Orden de compra" value={compra.orden_compra_numero || "—"} />
        </div>

        <div className="max-h-[50vh] overflow-y-auto px-5 pb-2">
          {cargando ? (
            <p className="py-6 text-center text-sm text-slate-400 animate-pulse">Cargando detalle…</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Producto</th>
                    <th className="px-3 py-2 text-center font-semibold">Cant.</th>
                    <th className="px-3 py-2 text-right font-semibold">Costo unit.</th>
                    <th className="px-3 py-2 text-center font-semibold">IVA</th>
                    <th className="px-3 py-2 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((it) => (
                    <tr key={it.id}>
                      <td className="px-3 py-2 text-slate-800">{it.producto_nombre}</td>
                      <td className="px-3 py-2 text-center tabular-nums text-slate-700">{it.cantidad}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600">{formatGs(it.costo_unitario)}</td>
                      <td className="px-3 py-2 text-center text-xs text-slate-500">{ivaLbl[it.iva_tipo] ?? it.iva_tipo}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-800">{formatGs(it.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="border-t border-slate-100 px-5 py-4">
          <div className="ml-auto flex max-w-xs items-center justify-between text-base font-bold text-slate-900">
            <span>Total</span>
            <span className="tabular-nums">{formatGs(compra.total)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-slate-800">{value}</p>
    </div>
  );
}

function VistaCompras({ filas, onVer }: { filas: ComprasPanel["compras"]; onVer: (c: ComprasPanel["compras"][number]) => void }) {
  return (
    <div className="rounded-2xl border border-[#4FAEB2]/30 bg-white p-6 shadow-sm ring-1 ring-[#4FAEB2]/10">
      {filas.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">No hay compras en el período seleccionado.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="border-b-2 border-[#4FAEB2]/40 bg-[#E5F4F4]">
              <tr>
                {["Fecha", "N° Compra", "N° Factura", "Proveedor", "Ítems", "Total", "Estado", "Detalle"].map((h, i) => (
                  <th key={h} className={`px-3 py-3 text-xs font-bold uppercase tracking-wide text-[#3F8E91] ${i === 4 || i === 5 ? "text-right" : i === 7 ? "text-center" : "text-left"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filas.map((c) => (
                <tr key={c.numero_control} className="transition-colors hover:bg-[#4FAEB2]/5">
                  <td className="px-3 py-2.5 text-xs tabular-nums text-slate-600">{formatFecha(c.fecha)}</td>
                  <td className="px-3 py-2.5 font-mono text-xs font-semibold text-[#3F8E91]">
                    {c.numero_control}
                    {c.orden_compra_numero && <span className="ml-1 rounded bg-[#E5F4F4] px-1 text-[10px] text-[#3F8E91]">{c.orden_compra_numero}</span>}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-slate-500">{c.numero_factura || "—"}</td>
                  <td className="px-3 py-2.5 text-xs font-medium text-slate-800">{c.proveedor_nombre}</td>
                  <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-600">{c.items_count}</td>
                  <td className="px-3 py-2.5 text-right text-xs tabular-nums font-bold text-slate-900">{formatGs(c.total)}</td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center rounded-full bg-[var(--badge-success-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--badge-success-text)]">
                      {ESTADO_COMPRA[c.estado] ?? c.estado}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <button type="button" onClick={() => onVer(c)} className="text-xs font-semibold text-[#3F8E91] hover:underline">Ver</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function VistaPendientes({ filas }: { filas: ComprasPanel["pendientes"] }) {
  return (
    <div className="rounded-2xl border border-[#4FAEB2]/30 bg-white p-6 shadow-sm ring-1 ring-[#4FAEB2]/10">
      {filas.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">
          No hay productos ordenados pendientes de recibir en el período seleccionado.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[1080px] text-sm">
            <thead className="border-b-2 border-[#4FAEB2]/40 bg-[#E5F4F4]">
              <tr>
                {["Fecha OC", "N° OC", "Proveedor", "Producto", "SKU", "Ordenada", "Recibida", "Pendiente", "Precio", "Subtotal pend.", "Estado", ""].map((h, i) => (
                  <th key={h} className={`px-3 py-3 text-xs font-bold uppercase tracking-wide text-[#3F8E91] ${i >= 5 && i <= 9 ? "text-right" : i === 10 || i === 11 ? "text-center" : "text-left"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filas.map((p) => {
                const est = ESTADO_OC[p.estado] ?? { lbl: p.estado, cls: "bg-slate-100 text-slate-500" };
                return (
                  <tr key={p.orden_item_id} className="transition-colors hover:bg-[#4FAEB2]/5">
                    <td className="px-3 py-2.5 text-xs tabular-nums text-slate-600">{formatFecha(p.fecha)}</td>
                    <td className="px-3 py-2.5 font-mono text-xs font-semibold text-[#3F8E91]">{p.numero_oc}</td>
                    <td className="px-3 py-2.5 text-xs font-medium text-slate-800">{p.proveedor_nombre}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-700">{p.producto_nombre}</td>
                    <td className="px-3 py-2.5 font-mono text-[11px] text-slate-400">{p.sku || "—"}</td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-600">{p.cantidad_ordenada}</td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums text-emerald-700">{p.cantidad_recibida}</td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums font-bold text-amber-700">{p.cantidad_pendiente}</td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-600">{formatGs(p.costo_unitario)}</td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums font-semibold text-slate-900">{formatGs(p.subtotal_pendiente)}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${est.cls}`}>{est.lbl}</span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <Link href={`/compras/desde-orden/${encodeURIComponent(p.numero_oc)}`} className="text-xs font-semibold text-emerald-700 hover:underline">Recibir</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
