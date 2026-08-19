"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getCompras } from "@/lib/compras/storage";
import { getOrdenesCompra } from "@/lib/ordenes-compra/storage";
import ExportExcelButton from "@/components/ui/ExportExcelButton";
import EdgeScrollArea from "@/components/ui/EdgeScrollArea";
import { FancySelect } from "@/components/ui/FancySelect";
import MobileFab from "@/components/ui/MobileFab";
import { productoMatchesQuery } from "@/lib/productos/token-search";
import type { Compra, TipoPago } from "@/lib/compras/types";
import type { OrdenCompra, EstadoOrdenCompra } from "@/lib/ordenes-compra/types";

const inputFilterClass =
  "border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none bg-white";

function formatGs(valor: number) {
  return `Gs. ${Math.round(valor).toLocaleString("es-PY")}`;
}

function formatFecha(iso: string) {
  try {
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
  } catch {
    return iso;
  }
}

const tipoPagoBadge: Record<TipoPago, string> = {
  contado: "bg-blue-50 text-blue-700",
  credito: "bg-orange-50 text-orange-700",
};

// ── Agrupación por numero_control: 1 compra = N filas ─────────────────────────
type GrupoCompra = {
  numero_control: string;
  proveedor_nombre: string;
  fecha: string;
  tipo_pago: TipoPago;
  plazo_dias?: number;
  items: Compra[];
  total: number;
  comprobante: boolean;
  orden_compra_numero: string | null;
  anulada: boolean;
};

function agrupar(rows: Compra[]): GrupoCompra[] {
  const map = new Map<string, GrupoCompra>();
  for (const c of rows) {
    const key = c.numero_control || c.id;
    let g = map.get(key);
    if (!g) {
      g = {
        numero_control: c.numero_control,
        proveedor_nombre: c.proveedor_nombre,
        fecha: c.fecha,
        tipo_pago: c.tipo_pago,
        plazo_dias: c.plazo_dias,
        items: [],
        total: 0,
        comprobante: false,
        orden_compra_numero: c.orden_compra_numero ?? null,
        anulada: !!c.anulada_at,
      };
      map.set(key, g);
    }
    g.items.push(c);
    g.total += Number(c.total) || 0;
    if (c.comprobante_storage_path) g.comprobante = true;
    if (c.anulada_at) g.anulada = true;
  }
  return [...map.values()].sort(
    (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()
  );
}

function resumenProductos(items: Compra[]): string {
  if (items.length === 0) return "—";
  if (items.length === 1) return items[0].producto_nombre;
  return `${items[0].producto_nombre} + ${items.length - 1} más`;
}

export default function ComprasPage() {
  const [todas, setTodas] = useState<Compra[]>([]);
  const [ordenes, setOrdenes] = useState<OrdenCompra[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [filtroTipoPago, setFiltroTipoPago] = useState<TipoPago | "">("");
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [anularTarget, setAnularTarget] = useState<{ numero_oc: string; estado: EstadoOrdenCompra } | null>(null);
  const [anularCompraTarget, setAnularCompraTarget] = useState<{ numero_control: string; total: number } | null>(null);
  const [editarCompraTarget, setEditarCompraTarget] = useState<{ numero_control: string; numero_factura: string; fecha_factura: string; nro_timbrado: string; observacion: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancel = false;
    getCompras().then((data) => { if (!cancel) setTodas(data); });
    getOrdenesCompra().then((data) => { if (!cancel) setOrdenes(data); });
    return () => { cancel = true; };
  }, [reloadKey]);

  const grupos = useMemo(() => agrupar(todas), [todas]);

  // Órdenes de compra por confirmar: pendientes o recibidas parcialmente.
  // El encargado las revisa y confirma la recepción desde acá.
  const ordenesPorConfirmar = useMemo(() => {
    const map = new Map<string, { numero_oc: string; proveedor_nombre: string; fecha: string; estado: EstadoOrdenCompra; items: number; totalPendiente: number }>();
    for (const o of ordenes) {
      if (o.estado !== "pendiente" && o.estado !== "recibida_parcial") continue;
      const g = map.get(o.numero_oc);
      const pendienteLinea = o.cantidad_pendiente * o.costo_unitario;
      if (g) { g.items += 1; g.totalPendiente += pendienteLinea; }
      else map.set(o.numero_oc, { numero_oc: o.numero_oc, proveedor_nombre: o.proveedor_nombre, fecha: o.fecha, estado: o.estado, items: 1, totalPendiente: pendienteLinea });
    }
    return [...map.values()].sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  }, [ordenes]);

  const filtrados = useMemo(() => {
    return grupos.filter((g) => {
      const coincideTexto = busqueda.trim() === "" || productoMatchesQuery(
        busqueda,
        g.proveedor_nombre,
        g.numero_control,
        ...g.items.map((i) => i.producto_nombre),
      );
      const coincideTipoPago = filtroTipoPago === "" || g.tipo_pago === filtroTipoPago;
      return coincideTexto && coincideTipoPago;
    });
  }, [grupos, busqueda, filtroTipoPago]);

  const hayFiltros = busqueda || filtroTipoPago;

  function toggle(numero: string) {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(numero)) next.delete(numero);
      else next.add(numero);
      return next;
    });
  }

  return (
    <div className="space-y-8">

      <div>
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-[#4FAEB2]"
            style={{ boxShadow: "0 0 0 3px rgba(79, 174, 178, 0.18)" }} />
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">Zentra · Adquisiciones</p>
        </div>
        <h1 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">Compras</h1>
        <p className="mt-0.5 text-xs text-slate-500">Facturas de proveedor registradas (impactan stock)</p>
      </div>

      {/* Navegación Compras / Órdenes de compra */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        <span className="border-b-2 border-[#4FAEB2] px-4 py-2 text-sm font-semibold text-[#3F8E91]">
          Compras
        </span>
        <Link
          href="/compras/ordenes"
          className="border-b-2 border-transparent px-4 py-2 text-sm font-medium text-slate-500 transition-colors hover:text-[#3F8E91]"
        >
          Órdenes de compra
        </Link>
      </div>

      {/* Órdenes de compra por confirmar (revisar + recibir) */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-[#4FAEB2]/15 sm:p-5 lg:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-800">
              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-[#4FAEB2] px-1.5 text-xs font-bold text-white">
                {ordenesPorConfirmar.length}
              </span>
              Órdenes de compra por confirmar
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Pedidos al proveedor pendientes de recibir. Revisá cada uno y confirmá lo que llegó.
            </p>
          </div>
          <Link href="/compras/ordenes/nueva"
            className="rounded-lg border border-[#4FAEB2]/40 bg-[#4FAEB2]/[0.08] px-3 py-1.5 text-xs font-semibold text-[#3F8E91] transition-colors hover:bg-[#4FAEB2]/[0.16] active:scale-95">
            + Nueva orden de compra
          </Link>
        </div>

        {ordenesPorConfirmar.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">
            No hay órdenes de compra pendientes de confirmar. Las órdenes recibidas por completo pasan a “Compras registradas”.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b-2 border-[#4FAEB2]/40 bg-[#E5F4F4]">
                <tr>
                  {["N° OC", "Fecha", "Proveedor", "Ítems", "Pendiente (Gs.)", "Estado", ""].map((h, i) => (
                    <th key={h} className={`px-3 py-2.5 text-xs font-bold uppercase tracking-wide text-[#3F8E91] ${i === 3 || i === 4 ? "text-right" : i === 5 || i === 6 ? "text-center" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ordenesPorConfirmar.map((o) => (
                  <tr key={o.numero_oc} className="transition-colors hover:bg-[#4FAEB2]/5">
                    <td className="px-3 py-2.5 font-mono text-xs font-semibold text-[#3F8E91]">{o.numero_oc}</td>
                    <td className="px-3 py-2.5 text-xs tabular-nums text-slate-600">{formatFecha(o.fecha)}</td>
                    <td className="px-3 py-2.5 text-xs font-medium text-slate-800">{o.proveedor_nombre || "—"}</td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-600">{o.items}</td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums font-bold text-slate-900">{formatGs(o.totalPendiente)}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${o.estado === "pendiente" ? "bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]" : "bg-sky-100 text-sky-700"}`}>
                        {o.estado === "pendiente" ? "Pendiente" : "Recibida parcial"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <div className="inline-flex items-center gap-3">
                        <Link href={`/compras/ordenes/${encodeURIComponent(o.numero_oc)}`} className="text-xs font-semibold text-slate-500 hover:text-[#3F8E91] hover:underline">Revisar</Link>
                        <Link href={`/compras/desde-orden/${encodeURIComponent(o.numero_oc)}`} className="rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-[#3F8E91]">Confirmar recepción</Link>
                        <button
                          type="button"
                          onClick={() => setAnularTarget({ numero_oc: o.numero_oc, estado: o.estado })}
                          className="text-xs font-semibold text-red-700 hover:underline"
                          title="Anular OC y revertir stock/movimientos"
                        >
                          Anular
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-[#4FAEB2]/15 sm:p-5 lg:p-6">

        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Compras registradas</h2>
          <div className="flex items-center gap-3">
            <ExportExcelButton url="/api/compras/export" />
            <Link href="/compras/desde-orden"
              className="rounded-lg border border-[#4FAEB2]/40 bg-[#4FAEB2]/[0.08] px-3 py-1.5 text-xs font-semibold text-[#3F8E91] transition-colors hover:bg-[#4FAEB2]/[0.16] active:scale-95">
              Desde Orden de Compra
            </Link>
            <Link href="/compras/nueva"
              className="rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-[#4FAEB2]/25 transition-colors hover:bg-[#3F8E91] active:scale-95">
              + Nueva compra
            </Link>
          </div>
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-3 mb-5 pb-5 border-b border-gray-100">
          <input type="text" placeholder="Buscar por proveedor, producto o N° control..."
            value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
            className={`${inputFilterClass} min-w-0 flex-1 sm:min-w-72`} />
          <FancySelect value={filtroTipoPago} onChange={(v) => setFiltroTipoPago(v as TipoPago | "")}
            ariaLabel="Filtrar por tipo de pago" className="w-44" size="sm"
            options={[
              { value: "", label: "Todos los pagos" },
              { value: "contado", label: "Contado" },
              { value: "credito", label: "Crédito" },
            ]} />
          {hayFiltros && (
            <button onClick={() => { setBusqueda(""); setFiltroTipoPago(""); }}
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors px-2">
              Limpiar filtros
            </button>
          )}
          <span className="ml-auto text-sm text-gray-400">
            {filtrados.length} de {grupos.length} compras
          </span>
        </div>

        {/* Tabla agrupada por compra */}
        <EdgeScrollArea>
          <table className="w-full min-w-[760px] lg:min-w-0 text-left text-sm">
            <thead>
              <tr className="border-b text-gray-500">
                <th className="py-3 pr-4 font-medium">N° Control</th>
                <th className="py-3 pr-4 font-medium">Proveedor</th>
                <th className="py-3 pr-4 font-medium">Productos</th>
                <th className="py-3 pr-4 font-medium text-right">Ítems</th>
                <th className="py-3 pr-4 font-medium text-right">Total</th>
                <th className="hidden py-3 pr-4 font-medium lg:table-cell">Pago</th>
                <th className="py-3 pr-4 font-medium">Fecha</th>
                <th className="py-3 font-medium text-center">Acción</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-gray-400">
                    {grupos.length === 0 ? "No hay compras registradas" : "Ninguna compra coincide con los filtros"}
                  </td>
                </tr>
              ) : (
                filtrados.map((g) => {
                  const abierto = expandidos.has(g.numero_control);
                  const multi = g.items.length > 1;
                  return (
                    <FragmentRow key={g.numero_control}>
                      <tr
                        className={`border-b border-slate-200 transition-colors ${g.anulada ? "bg-red-50/40 text-slate-400 line-through hover:bg-red-50/60" : "hover:bg-[#4FAEB2]/[0.04]"} ${multi ? "cursor-pointer" : ""}`}
                        onClick={() => multi && toggle(g.numero_control)}
                      >
                        <td className="py-4 pr-4 font-mono text-xs text-gray-500">
                          {multi && <span className="mr-1 inline-block text-gray-400">{abierto ? "▾" : "▸"}</span>}
                          {g.numero_control}
                          {g.anulada && (
                            <span className="ml-2 inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700 no-underline">
                              Anulada
                            </span>
                          )}
                        </td>
                        <td className="py-4 pr-4 font-medium text-gray-800">{g.proveedor_nombre}</td>
                        <td className="py-4 pr-4 text-gray-600">
                          <div>{resumenProductos(g.items)}</div>
                          {g.orden_compra_numero && (
                            <Link
                              href={`/compras/ordenes/${encodeURIComponent(g.orden_compra_numero)}`}
                              onClick={(e) => e.stopPropagation()}
                              className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-[#E5F4F4] px-2 py-0.5 text-[11px] font-semibold text-[#3F8E91] hover:underline"
                            >
                              {g.orden_compra_numero}
                            </Link>
                          )}
                          {g.comprobante && (
                            <a
                              href={`/api/compras/comprobante?numero_control=${encodeURIComponent(g.numero_control)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-[#4FAEB2] hover:text-[#3F8E91] hover:underline"
                            >
                              📎 Ver comprobante
                            </a>
                          )}
                        </td>
                        <td className="py-4 pr-4 text-right tabular-nums text-gray-700">{g.items.length}</td>
                        <td className="py-4 pr-4 text-right tabular-nums font-semibold text-gray-800">{formatGs(g.total)}</td>
                        <td className="hidden py-4 pr-4 lg:table-cell">
                          <span className={`px-2 py-1 rounded-full text-xs font-semibold ${g.tipo_pago ? tipoPagoBadge[g.tipo_pago] : "bg-gray-100 text-gray-500"}`}>
                            {g.tipo_pago === "contado" ? "Contado" : g.tipo_pago === "credito" ? `Crédito ${g.plazo_dias ?? ""}d` : "—"}
                          </span>
                        </td>
                        <td className="py-4 pr-4 text-gray-500 text-xs tabular-nums">{formatFecha(g.fecha)}</td>
                        <td className="py-4 text-center" onClick={(e) => e.stopPropagation()}>
                          {g.anulada ? (
                            <span className="text-xs italic text-slate-400 no-underline">Sin acciones</span>
                          ) : (
                            <div className="inline-flex items-center gap-3">
                              <button
                                type="button"
                                onClick={() => {
                                  const primera = g.items[0];
                                  setEditarCompraTarget({
                                    numero_control: g.numero_control,
                                    numero_factura: primera?.numero_factura ?? "",
                                    fecha_factura: primera?.fecha_factura ?? "",
                                    nro_timbrado: primera?.nro_timbrado ?? "",
                                    observacion: primera?.observacion ?? "",
                                  });
                                }}
                                className="text-xs font-semibold text-slate-600 hover:underline"
                                title="Editar factura/timbrado/observación (no afecta stock)"
                              >
                                Editar
                              </button>
                              <button
                                type="button"
                                onClick={() => setAnularCompraTarget({ numero_control: g.numero_control, total: g.total })}
                                className="text-xs font-semibold text-red-700 hover:underline"
                                title="Anular compra y revertir stock/movimientos"
                              >
                                Anular
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>

                      {abierto && multi && g.items.map((it) => (
                        <tr key={it.id} className="border-b border-slate-100 bg-slate-50/50 text-xs">
                          <td className="py-2 pr-4" />
                          <td className="py-2 pr-4" />
                          <td className="py-2 pr-4 text-gray-700">
                            <span className="font-medium">{it.producto_nombre}</span>
                            <span className="ml-2 font-mono text-gray-400">{formatGs(it.costo_unitario)}/u</span>
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums text-gray-600">{it.cantidad}</td>
                          <td className="py-2 pr-4 text-right tabular-nums text-gray-700">{formatGs(it.total)}</td>
                          <td className="hidden lg:table-cell" />
                          <td />
                          <td />
                        </tr>
                      ))}
                    </FragmentRow>
                  );
                })
              )}
            </tbody>
          </table>
        </EdgeScrollArea>

      </div>

      <MobileFab href="/compras/nueva" label="Nueva compra" />

      {anularTarget && (
        <AnularOcInlineModal
          numero_oc={anularTarget.numero_oc}
          estado={anularTarget.estado}
          onClose={() => setAnularTarget(null)}
          onDone={() => { setAnularTarget(null); setReloadKey((k) => k + 1); }}
        />
      )}
      {anularCompraTarget && (
        <AnularCompraModal
          numero_control={anularCompraTarget.numero_control}
          total={anularCompraTarget.total}
          onClose={() => setAnularCompraTarget(null)}
          onDone={() => { setAnularCompraTarget(null); setReloadKey((k) => k + 1); }}
        />
      )}
      {editarCompraTarget && (
        <EditarCompraModal
          data={editarCompraTarget}
          onClose={() => setEditarCompraTarget(null)}
          onDone={() => { setEditarCompraTarget(null); setReloadKey((k) => k + 1); }}
        />
      )}
    </div>
  );
}

function EditarCompraModal({
  data,
  onClose,
  onDone,
}: {
  data: { numero_control: string; numero_factura: string; fecha_factura: string; nro_timbrado: string; observacion: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({ ...data });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    setLoading(true);
    try {
      const r = await fetch(`/api/compras/${encodeURIComponent(data.numero_control)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          numero_factura: form.numero_factura.trim() || null,
          fecha_factura: form.fecha_factura || null,
          nro_timbrado: form.nro_timbrado.trim() || null,
          observacion: form.observacion.trim() || null,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) throw new Error((j as { error?: string })?.error ?? `Error ${r.status}`);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo actualizar.");
    } finally {
      setLoading(false);
    }
  }

  const input = "w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#4FAEB2]/30";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="text-base font-bold text-slate-900">Editar compra {data.numero_control}</h3>
          <p className="mt-0.5 text-xs text-slate-500">Solo se editan datos de la factura y observación. No cambia stock, costos ni cuentas por pagar.</p>
        </div>
        <div className="space-y-3 px-5 py-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Número de factura</label>
            <input value={form.numero_factura} onChange={(e) => setForm({ ...form, numero_factura: e.target.value })} className={input} placeholder="Ej: 001-001-1234567" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Fecha de factura</label>
            <input type="date" value={form.fecha_factura} onChange={(e) => setForm({ ...form, fecha_factura: e.target.value })} className={input} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Nº de timbrado</label>
            <input value={form.nro_timbrado} onChange={(e) => setForm({ ...form, nro_timbrado: e.target.value })} className={input} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Observación</label>
            <textarea rows={3} value={form.observacion} onChange={(e) => setForm({ ...form, observacion: e.target.value })} className={input} />
          </div>
          {err && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancelar</button>
          <button type="button" onClick={submit} disabled={loading}
            className="rounded-md bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50">
            {loading ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Wrapper para agrupar fila principal + filas de detalle sin <div> en <tbody>. */
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function AnularCompraModal({
  numero_control,
  total,
  onClose,
  onDone,
}: {
  numero_control: string;
  total: number;
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
        `/api/compras/${encodeURIComponent(numero_control)}/anular`,
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
      setError(e instanceof Error ? e.message : "No se pudo anular la compra.");
    } finally {
      setLoading(false);
    }
  }

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
          <h3 className="text-base font-bold text-red-800">Anular compra {numero_control}</h3>
          <p className="mt-1 text-xs text-red-700">
            Se va a revertir el stock ingresado (Gs. {Math.round(total).toLocaleString("es-PY")}) y crear un
            contra-movimiento en Inventario. La compra queda marcada como ANULADA. Esta acción no se puede deshacer.
          </p>
        </div>
        <div className="p-5 space-y-3">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Motivo (opcional)</span>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej: mercadería con defecto, error de carga, devolución al proveedor…"
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
              {loading ? "Anulando..." : "Anular compra"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AnularOcInlineModal({
  numero_oc,
  estado,
  onClose,
  onDone,
}: {
  numero_oc: string;
  estado: EstadoOrdenCompra;
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
        `/api/ordenes-compra/${encodeURIComponent(numero_oc)}/anular`,
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

  const yaRecibida = estado === "recibida_parcial" || estado === "recibida_total";

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
          <h3 className="text-base font-bold text-red-800">Anular OC {numero_oc}</h3>
          <p className="mt-1 text-xs text-red-700">
            {yaRecibida
              ? "Esta OC ya tiene mercadería recibida. Se va a REVERTIR el stock y crear contra-movimientos en Inventario."
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
