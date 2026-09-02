"use client";

/** Nueva reserva (mercadería en guarda): cliente + productos → sale del stock. */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, ArrowLeft } from "lucide-react";
import Link from "next/link";
import MontoInput from "@/components/ui/MontoInput";
import BuscadorProducto from "@/components/inventario/BuscadorProducto";
import { FancySelect } from "@/components/ui/FancySelect";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { getProductos } from "@/lib/inventario/storage";
import { getClientes, clienteNombre } from "@/lib/clientes/storage";

type Prod = { id: string; nombre: string; sku: string | null; precio_venta: number };
type Linea = { producto_id: string; cantidad: number; precio_unitario: number; tipo_iva: string };
const IVAS = ["10%", "5%", "EXENTA"];
const fmtGs = (n: number) => `Gs. ${Math.round(n || 0).toLocaleString("es-PY")}`;

export default function NuevaReservaPage() {
  const router = useRouter();
  const [prods, setProds] = useState<Prod[]>([]);
  const [clientes, setClientes] = useState<{ id: string; nombre: string }[]>([]);
  const [clienteId, setClienteId] = useState("");
  const [clienteNombreLibre, setClienteNombreLibre] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([{ producto_id: "", cantidad: 1, precio_unitario: 0, tipo_iva: "10%" }]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProductos().then((ps) => setProds(ps.map((p) => ({ id: String(p.id), nombre: p.nombre, sku: p.sku ?? null, precio_venta: Number(p.precio_venta) || 0 }))));
    getClientes().then((cs) => setClientes(cs.map((c) => ({ id: c.id, nombre: clienteNombre(c) }))));
  }, []);

  const prodById = useMemo(() => new Map(prods.map((p) => [p.id, p])), [prods]);
  const total = lineas.reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.precio_unitario) || 0), 0);

  function upd(i: number, patch: Partial<Linea>) {
    setLineas((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function setProducto(i: number, id: string) {
    const p = prodById.get(id);
    upd(i, { producto_id: id, precio_unitario: p?.precio_venta || 0 });
  }

  async function guardar() {
    setError(null);
    const items = lineas
      .filter((l) => l.producto_id && l.cantidad > 0)
      .map((l) => {
        const p = prodById.get(l.producto_id);
        return { producto_id: l.producto_id, producto_nombre: p?.nombre ?? "", sku: p?.sku ?? null, cantidad: l.cantidad, precio_unitario: l.precio_unitario, tipo_iva: l.tipo_iva };
      });
    if (items.length === 0) { setError("Agregá al menos un producto."); return; }
    setGuardando(true);
    try {
      const r = await fetchWithSupabaseSession("/api/reservas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente_id: clienteId || null,
          cliente_nombre: clienteId ? (clientes.find((c) => c.id === clienteId)?.nombre ?? null) : (clienteNombreLibre.trim() || null),
          observaciones: observaciones.trim() || null,
          items,
        }),
      });
      const j = await r.json();
      if (!r.ok || j?.success === false) throw new Error(j?.error ?? `Error ${r.status}`);
      router.push(`/reservas/${j.data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear la reserva.");
    } finally {
      setGuardando(false);
    }
  }

  const prodBuscables = prods.map((p) => ({ id: p.id, nombre: p.nombre, sku: p.sku }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/reservas" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"><ArrowLeft className="h-4 w-4" /> Reservas</Link>
      <h1 className="text-2xl font-bold text-slate-900">Nueva reserva</h1>
      <p className="text-sm text-slate-500">Al guardar, la mercadería sale del stock y queda en guarda. El anticipo y los retiros se cargan después.</p>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Cliente</span>
            <div className="mt-1">
              <FancySelect value={clienteId} onChange={setClienteId} placeholder="Buscar cliente…"
                options={[{ value: "", label: "— Sin cliente / nombre libre —" }, ...clientes.map((c) => ({ value: c.id, label: c.nombre }))]} />
            </div>
          </label>
          {!clienteId && (
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Nombre del cliente (libre)</span>
              <input value={clienteNombreLibre} onChange={(e) => setClienteNombreLibre(e.target.value)} placeholder="Ej: María Inés Verdún"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 outline-none" />
            </label>
          )}
        </div>

        <div className="space-y-2">
          <div className="grid grid-cols-12 gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <div className="col-span-5">Producto</div><div className="col-span-2 text-right">Cantidad</div>
            <div className="col-span-2 text-right">Precio</div><div className="col-span-1">IVA</div>
            <div className="col-span-1 text-right">Total</div><div className="col-span-1"></div>
          </div>
          {lineas.map((l, i) => (
            <div key={i} className="grid grid-cols-12 items-center gap-2">
              <div className="col-span-5"><BuscadorProducto productos={prodBuscables} value={l.producto_id} onChange={(id) => setProducto(i, id)} /></div>
              <div className="col-span-2"><input type="number" min={0} step="1" value={l.cantidad} onChange={(e) => upd(i, { cantidad: Number(e.target.value) })} className="w-full rounded-lg border border-slate-300 px-2 py-2 text-right text-sm outline-none focus:border-[#4FAEB2]" /></div>
              <div className="col-span-2"><MontoInput value={l.precio_unitario} onChange={(n) => upd(i, { precio_unitario: n })} className="w-full rounded-lg border border-slate-300 px-2 py-2 text-right text-sm outline-none focus:border-[#4FAEB2]" /></div>
              <div className="col-span-1">
                <select value={l.tipo_iva} onChange={(e) => upd(i, { tipo_iva: e.target.value })} className="w-full rounded-lg border border-slate-300 px-1 py-2 text-xs bg-white outline-none focus:border-[#4FAEB2]">
                  {IVAS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
                </select>
              </div>
              <div className="col-span-1 text-right text-sm tabular-nums">{fmtGs((l.cantidad || 0) * (l.precio_unitario || 0))}</div>
              <div className="col-span-1 text-right">
                <button onClick={() => setLineas((prev) => prev.filter((_, idx) => idx !== i))} className="text-red-600 hover:text-red-700" aria-label="Quitar"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
          <button onClick={() => setLineas((prev) => [...prev, { producto_id: "", cantidad: 1, precio_unitario: 0, tipo_iva: "10%" }])}
            className="mt-1 rounded-md border border-dashed border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">+ Agregar producto</button>
        </div>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Observaciones</span>
          <textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={2}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#4FAEB2]" />
        </label>

        <div className="flex items-center justify-between border-t border-slate-200 pt-3">
          <span className="text-sm font-semibold text-slate-700">Total de la reserva</span>
          <span className="text-lg font-bold tabular-nums text-[#3F8E91]">{fmtGs(total)}</span>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="flex justify-end gap-2">
          <Link href="/reservas" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancelar</Link>
          <button onClick={guardar} disabled={guardando} className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-bold text-white hover:bg-[#3F8E91] disabled:opacity-50">
            {guardando ? "Guardando…" : "Crear reserva (sale del stock)"}
          </button>
        </div>
      </div>
    </div>
  );
}
