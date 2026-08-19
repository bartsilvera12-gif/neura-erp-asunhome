"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Trash2, Loader2, Plus } from "lucide-react";
import { getProveedores } from "@/lib/proveedores/storage";
import { getProductos } from "@/lib/inventario/storage";
import { saveOrdenCompra, type OrdenItemPayload } from "@/lib/ordenes-compra/storage";
import { productoMatchesQuery } from "@/lib/productos/token-search";
import type { Proveedor } from "@/lib/proveedores/types";
import type { Producto } from "@/lib/inventario/types";
import type { TipoIva, TipoPago, Moneda } from "@/lib/compras/types";

function fmtGs(v: number) {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}
/** IVA INCLUIDO (modelo PY): el costo ya contiene el IVA; se desglosa desde adentro. */
function desglosarIva(bruto: number, iva: TipoIva): { subtotal: number; monto_iva: number } {
  if (iva === "exenta") return { subtotal: bruto, monto_iva: 0 };
  const factor = iva === "5" ? 1.05 : 1.1;
  const subtotal = bruto / factor;
  return { subtotal, monto_iva: bruto - subtotal };
}

type Linea = {
  producto_id: string;
  producto_nombre: string;
  sku: string;
  cantidad: number;
  costo_input: number; // en la moneda de la cabecera
  iva_tipo: TipoIva;
  precio_venta: number;
};

const inputClass = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#4FAEB2]/30 bg-white";

export default function NuevaOrdenCompraPage() {
  const router = useRouter();
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cab, setCab] = useState({
    proveedor_id: "",
    moneda: "PYG" as Moneda,
    tipo_cambio: "",
    tipo_pago: "contado" as TipoPago,
    plazo_dias: "",
    observacion: "",
  });
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [q, setQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getProveedores().then(setProveedores).catch(() => setProveedores([]));
    getProductos().then(setProductos).catch(() => setProductos([]));
  }, []);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) setSearchOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const tc = cab.moneda === "USD" ? Number(cab.tipo_cambio) || 0 : 1;

  const excluidos = useMemo(() => new Set(lineas.map((l) => l.producto_id)), [lineas]);
  const resultados = useMemo(() => {
    const query = q.trim();
    if (query.length < 2) return [];
    return productos
      .filter((p) => !excluidos.has(String(p.id)) && productoMatchesQuery(query, p.nombre, p.sku))
      .slice(0, 20);
  }, [productos, excluidos, q]);

  function addProducto(p: Producto) {
    setLineas((prev) => [
      ...prev,
      {
        producto_id: String(p.id),
        producto_nombre: p.nombre,
        sku: p.sku,
        cantidad: 1,
        // Precarga el costo actual del producto (costo_promedio en PYG).
        // Si la OC es en USD, el usuario ajusta manualmente porque las unidades
        // difieren; en ese caso arranca en 0.
        costo_input: cab.moneda === "PYG" ? (Number(p.costo_promedio) || 0) : 0,
        iva_tipo: "10",
        precio_venta: Number(p.precio_venta) || 0,
      },
    ]);
    setQ("");
    setSearchOpen(false);
  }
  function updateLinea(id: string, patch: Partial<Linea>) {
    setLineas((prev) => prev.map((l) => (l.producto_id === id ? { ...l, ...patch } : l)));
  }
  function removeLinea(id: string) {
    setLineas((prev) => prev.filter((l) => l.producto_id !== id));
  }

  const totalOc = useMemo(
    () => lineas.reduce((s, l) => s + l.costo_input * tc * l.cantidad, 0),
    [lineas, tc]
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!cab.proveedor_id) return setErr("Seleccioná un proveedor.");
    if (cab.moneda === "USD" && tc <= 0) return setErr("Cargá el tipo de cambio (USD → Gs.).");
    if (lineas.length === 0) return setErr("Agregá al menos un producto.");
    const mala = lineas.find((l) => l.cantidad <= 0 || l.costo_input <= 0);
    if (mala) return setErr(`Revisá "${mala.producto_nombre}": cantidad y costo deben ser mayores a 0.`);

    const prov = proveedores.find((p) => String(p.id) === cab.proveedor_id);
    if (!prov) return setErr("Proveedor no encontrado.");

    const items: OrdenItemPayload[] = lineas.map((l) => {
      const costoPyg = l.costo_input * tc;
      const totalLinea = costoPyg * l.cantidad;
      const { subtotal, monto_iva } = desglosarIva(totalLinea, l.iva_tipo);
      return {
        producto_id: l.producto_id,
        producto_nombre: l.producto_nombre,
        cantidad: l.cantidad,
        costo_unitario: Math.round(costoPyg),
        costo_unitario_original: l.costo_input,
        iva_tipo: l.iva_tipo,
        subtotal: Math.round(subtotal),
        monto_iva: Math.round(monto_iva),
        total: Math.round(totalLinea),
        precio_venta: Math.round(l.precio_venta),
        margen_venta: null,
      };
    });

    setEnviando(true);
    try {
      const res = await saveOrdenCompra(
        {
          proveedor_id: String(prov.id),
          proveedor_nombre: prov.nombre,
          moneda: cab.moneda,
          tipo_cambio: tc,
          tipo_pago: cab.tipo_pago,
          plazo_dias: cab.tipo_pago === "credito" && cab.plazo_dias ? parseInt(cab.plazo_dias) : undefined,
          observacion: cab.observacion.trim() || null,
        },
        items
      );
      if (!res.success) { setErr(res.error); return; }
      router.push(`/compras/ordenes/${encodeURIComponent(res.numero_oc)}`);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link href="/compras/ordenes" className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-[#3F8E91]">
        ← Órdenes de compra
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Nueva orden de compra</h1>
        <p className="mt-1 text-sm text-slate-500">Productos y costos pactados con el proveedor. No pide factura ni impacta stock — eso se hace al recibir.</p>
      </div>

      <form onSubmit={onSubmit} className="space-y-6">
        {/* Cabecera */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-slate-600">Proveedor <span className="text-red-500">*</span></label>
              <select value={cab.proveedor_id} onChange={(e) => setCab((p) => ({ ...p, proveedor_id: e.target.value }))} className={inputClass}>
                <option value="">— Seleccioná un proveedor —</option>
                {proveedores.map((p) => (
                  <option key={p.id} value={String(p.id)}>{p.nombre}{p.ruc ? ` · ${p.ruc}` : ""}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Moneda</label>
              <select value={cab.moneda} onChange={(e) => setCab((p) => ({ ...p, moneda: e.target.value as Moneda }))} className={inputClass}>
                <option value="PYG">Guaraníes (PYG)</option>
                <option value="USD">Dólares (USD)</option>
              </select>
            </div>
            {cab.moneda === "USD" && (
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Tipo de cambio</label>
                <input type="number" min={0} value={cab.tipo_cambio} onChange={(e) => setCab((p) => ({ ...p, tipo_cambio: e.target.value }))} placeholder="Ej: 7300" className={inputClass} />
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Tipo de pago</label>
              <select value={cab.tipo_pago} onChange={(e) => setCab((p) => ({ ...p, tipo_pago: e.target.value as TipoPago }))} className={inputClass}>
                <option value="contado">Contado</option>
                <option value="credito">Crédito</option>
              </select>
            </div>
            {cab.tipo_pago === "credito" && (
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Plazo (días)</label>
                <input type="number" min={1} value={cab.plazo_dias} onChange={(e) => setCab((p) => ({ ...p, plazo_dias: e.target.value }))} className={inputClass} />
              </div>
            )}
            <div className="sm:col-span-2 lg:col-span-4">
              <label className="mb-1 block text-xs font-semibold text-slate-600">Observación <span className="font-normal text-slate-400">(opcional)</span></label>
              <input value={cab.observacion} onChange={(e) => setCab((p) => ({ ...p, observacion: e.target.value }))} className={inputClass} placeholder="Notas de la orden…" />
            </div>
          </div>
        </div>

        {/* Buscador de productos */}
        <div ref={searchBoxRef} className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-[#4FAEB2]" />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)}
            placeholder="Buscar producto por nombre, SKU o palabras clave…"
            className="h-14 w-full rounded-2xl border-2 border-[#4FAEB2]/25 bg-white pl-12 pr-4 text-base outline-none focus:border-[#4FAEB2] focus:ring-4 focus:ring-[#4FAEB2]/15"
            autoComplete="off"
          />
          {searchOpen && q.trim().length >= 2 && (
            <div className="absolute left-0 right-0 top-full z-30 mt-2 max-h-[50vh] overflow-y-auto rounded-2xl border-2 border-[#4FAEB2]/20 bg-white shadow-[0_16px_40px_-12px_rgba(15,23,42,0.28)]">
              {resultados.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-slate-400">Sin resultados para &quot;{q}&quot;</div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {resultados.map((p) => (
                    <li key={String(p.id)}>
                      <button type="button" onClick={() => addProducto(p)}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[#4FAEB2]/8">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-800">{p.nombre}</p>
                          <p className="text-xs font-mono text-slate-500">{p.sku}</p>
                        </div>
                        <span className="inline-flex items-center gap-1 rounded-lg bg-[#4FAEB2]/10 px-2.5 py-1 text-xs font-bold text-[#3F8E91]">
                          <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> Agregar
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Ítems */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {lineas.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-400">Buscá productos arriba y agregalos a la orden.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Producto</th>
                    <th className="px-3 py-3 text-center text-[11px] font-bold uppercase tracking-wide text-slate-500">Cant.</th>
                    <th className="px-3 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Costo unit. ({cab.moneda})</th>
                    <th className="px-3 py-3 text-center text-[11px] font-bold uppercase tracking-wide text-slate-500">IVA</th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Total (Gs.)</th>
                    <th className="w-10 px-2 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lineas.map((l) => (
                    <tr key={l.producto_id} className="hover:bg-[#4FAEB2]/5">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-900">{l.producto_nombre}</p>
                        <p className="font-mono text-[11px] text-slate-500">{l.sku}</p>
                      </td>
                      <td className="px-3 py-3">
                        <input type="number" min={0} value={l.cantidad === 0 ? "" : l.cantidad}
                          onChange={(e) => updateLinea(l.producto_id, { cantidad: Math.max(0, parseInt(e.target.value) || 0) })}
                          onBlur={(e) => { if (!e.target.value || Number(e.target.value) < 1) updateLinea(l.producto_id, { cantidad: 1 }); }}
                          className="mx-auto h-8 w-16 rounded-md border border-slate-200 px-2 text-center text-sm tabular-nums" />
                      </td>
                      <td className="px-3 py-3 text-right">
                        <input type="number" min={0} value={l.costo_input}
                          onChange={(e) => updateLinea(l.producto_id, { costo_input: Math.max(0, Number(e.target.value) || 0) })}
                          className="h-8 w-28 rounded-md border border-slate-200 px-2 text-right text-sm tabular-nums" />
                      </td>
                      <td className="px-3 py-3">
                        <div className="mx-auto inline-flex overflow-hidden rounded-lg border border-slate-200">
                          {(["exenta", "5", "10"] as const).map((iva) => {
                            const sel = l.iva_tipo === iva;
                            return (
                              <button key={iva} type="button" onClick={() => updateLinea(l.producto_id, { iva_tipo: iva })}
                                className={`px-2 py-1.5 text-[11px] font-semibold transition-colors ${sel ? "bg-[#4FAEB2] text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}>
                                {iva === "exenta" ? "Ex" : `${iva}%`}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-bold tabular-nums text-slate-900">
                        {fmtGs(l.costo_input * tc * l.cantidad)}
                      </td>
                      <td className="px-2 py-3 text-center">
                        <button type="button" onClick={() => removeLinea(l.producto_id)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Quitar">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {err && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

        {/* Total + submit */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total estimado</p>
            <p className="text-2xl font-bold tabular-nums text-slate-900">{fmtGs(totalOc)}</p>
          </div>
          <button type="submit" disabled={enviando}
            className="inline-flex items-center gap-2 rounded-xl bg-[#4FAEB2] px-6 py-3 text-sm font-bold text-white shadow-md shadow-[#4FAEB2]/30 hover:bg-[#3F8E91] disabled:opacity-50">
            {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
            Crear orden de compra
          </button>
        </div>
      </form>
    </div>
  );
}
