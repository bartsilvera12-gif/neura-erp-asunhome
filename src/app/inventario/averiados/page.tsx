"use client";

/**
 * Productos averiados (devoluciones de cliente). No salen de stock.
 * Listado + cambio de estado + carga manual.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const inputClass =
  "w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#0EA5E9] outline-none";

type Estado = "detectado" | "en_revision" | "en_garantia_proveedor" | "reparado" | "descartado" | "devuelto_proveedor";

const ESTADO_LABEL: Record<Estado, string> = {
  detectado: "Apartado",
  en_revision: "En revisión",
  en_garantia_proveedor: "Con proveedor",
  reparado: "Recuperado",
  descartado: "Dado de baja",
  devuelto_proveedor: "Devuelto al proveedor",
};
const ESTADO_BADGE: Record<Estado, string> = {
  detectado: "bg-rose-50 text-rose-700 border-rose-200",
  en_revision: "bg-amber-50 text-amber-700 border-amber-200",
  en_garantia_proveedor: "bg-violet-50 text-violet-700 border-violet-200",
  reparado: "bg-emerald-50 text-emerald-700 border-emerald-200",
  descartado: "bg-slate-100 text-slate-500 border-slate-200",
  devuelto_proveedor: "bg-sky-50 text-sky-700 border-sky-200",
};
const ESTADOS = Object.keys(ESTADO_LABEL) as Estado[];

interface Averiado {
  id: string;
  producto_nombre: string | null;
  sku: string | null;
  numero_serie: string | null;
  proveedor_nombre: string | null;
  cantidad: number;
  descripcion: string | null;
  estado: Estado;
  fecha_deteccion: string;
  observaciones: string | null;
}
interface ProductoOpt { id: string; nombre: string; sku?: string | null }

function fmt(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("es-PY");
}

export default function AveriadosPage() {
  const [filas, setFilas] = useState<Averiado[]>([]);
  const [cargando, setCargando] = useState(true);
  const [q, setQ] = useState("");
  const [nuevo, setNuevo] = useState(false);
  const [productos, setProductos] = useState<ProductoOpt[]>([]);
  const [fProducto, setFProducto] = useState("");
  const [fSerie, setFSerie] = useState("");
  const [fDesc, setFDesc] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setCargando(true);
    try {
      const sp = new URLSearchParams();
      if (q.trim()) sp.set("q", q.trim());
      const r = await fetch(`/api/averiados?${sp}`, { credentials: "include", cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      setFilas(j?.success ? (j.data.filas ?? []) : []);
    } finally {
      setCargando(false);
    }
  }, [q]);

  useEffect(() => {
    const t = setTimeout(() => { void reload(); }, 250);
    return () => clearTimeout(t);
  }, [reload]);

  useEffect(() => {
    if (!nuevo || productos.length) return;
    (async () => {
      try {
        const r = await fetch("/api/productos?limit=1000", { credentials: "include", cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        const arr = (j?.data?.productos ?? j?.data ?? []) as ProductoOpt[];
        if (Array.isArray(arr)) setProductos(arr);
      } catch { /* no bloquea */ }
    })();
  }, [nuevo, productos.length]);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!fProducto) { setError("Elegí un producto."); return; }
    const r = await fetch("/api/averiados", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ producto_id: fProducto, numero_serie: fSerie.trim() || null, descripcion: fDesc.trim() || null }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) { setError(j?.error ?? "No se pudo registrar."); return; }
    setNuevo(false); setFProducto(""); setFSerie(""); setFDesc("");
    await reload();
  }

  async function cambiarEstado(id: string, estado: Estado) {
    await fetch("/api/averiados", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ id, estado }),
    });
    await reload();
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 pb-10 sm:px-6 lg:px-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/inventario" className="text-sm text-sky-600 hover:underline">← Inventario</Link>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">Productos averiados</h1>
          <p className="text-sm text-slate-600">
            Productos devueltos por el cliente (así les dice la dueña: "averiados"). No están necesariamente rotos. Siguen contando en stock; acá se ve cuáles hay.
          </p>
        </div>
        <button onClick={() => setNuevo(!nuevo)} className="shrink-0 rounded-lg bg-[#0EA5E9] px-4 py-2 text-sm font-medium text-white hover:bg-[#0284C7]">
          {nuevo ? "Cerrar" : "+ Cargar averiado"}
        </button>
      </div>

      {nuevo && (
        <form onSubmit={crear} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-1">
              <label className="mb-1 block text-xs font-medium text-slate-600">Producto *</label>
              <select className={inputClass} value={fProducto} onChange={(e) => setFProducto(e.target.value)}>
                <option value="">Elegir…</option>
                {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Nº de serie</label>
              <input className={inputClass} value={fSerie} onChange={(e) => setFSerie(e.target.value)} placeholder="Opcional" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Motivo / nota</label>
              <input className={inputClass} value={fDesc} onChange={(e) => setFDesc(e.target.value)} placeholder="Ej: modelo equivocado" />
            </div>
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <button type="submit" className="rounded-lg bg-[#0EA5E9] px-4 py-2 text-sm font-medium text-white hover:bg-[#0284C7]">Registrar</button>
        </form>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-3">
          <input className={`${inputClass} max-w-xs`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por producto o serie…" />
          <span className="ml-auto text-xs text-slate-500">{filas.length} averiados</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-slate-600">
                <th className="px-3 py-2 font-semibold">Producto</th>
                <th className="px-3 py-2 font-semibold">Nº serie</th>
                <th className="px-3 py-2 font-semibold">Proveedor</th>
                <th className="px-3 py-2 font-semibold">Motivo / nota</th>
                <th className="px-3 py-2 font-semibold">Fecha</th>
                <th className="px-3 py-2 font-semibold">Estado</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((a) => (
                <tr key={a.id} className="border-b border-slate-50">
                  <td className="px-3 py-2.5 font-medium text-slate-900">{a.producto_nombre ?? "—"}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-slate-500">{a.numero_serie ?? "—"}</td>
                  <td className="px-3 py-2.5 text-slate-600">{a.proveedor_nombre ?? "—"}</td>
                  <td className="px-3 py-2.5 text-slate-600">{a.descripcion ?? "—"}</td>
                  <td className="px-3 py-2.5 tabular-nums text-slate-500">{fmt(a.fecha_deteccion)}</td>
                  <td className="px-3 py-2.5">
                    <select
                      value={a.estado}
                      onChange={(e) => void cambiarEstado(a.id, e.target.value as Estado)}
                      className={`rounded-md border px-2 py-1 text-xs font-semibold ${ESTADO_BADGE[a.estado]}`}
                    >
                      {ESTADOS.map((e) => <option key={e} value={e}>{ESTADO_LABEL[e]}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!cargando && filas.length === 0 && <p className="py-10 text-center text-slate-400">No hay productos averiados.</p>}
        {cargando && <p className="py-10 text-center text-slate-400">Cargando…</p>}
      </div>
    </div>
  );
}
