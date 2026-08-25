"use client";

/**
 * En el técnico. Dos orígenes en un módulo:
 *  - Interno: producto propio dañado de fábrica. Sale del stock; al marcarlo
 *    "listo" con reintegro, vuelve al stock.
 *  - Cliente: equipo que trae un cliente a reparar.
 */
import Link from "next/link";
import BuscadorProducto from "@/components/inventario/BuscadorProducto";
import { useCallback, useEffect, useState } from "react";

const inputClass =
  "w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#0EA5E9] outline-none";

type Origen = "interno" | "cliente";
type Estado = "recibido" | "en_diagnostico" | "presupuestado" | "aprobado" | "en_reparacion" | "listo" | "entregado" | "rechazado" | "anulado";

const ESTADO_LABEL: Record<Estado, string> = {
  recibido: "Recibido", en_diagnostico: "En diagnóstico", presupuestado: "Presupuestado",
  aprobado: "Aprobado", en_reparacion: "En reparación", listo: "Listo",
  entregado: "Entregado", rechazado: "Rechazado", anulado: "Anulado",
};
const ESTADOS = Object.keys(ESTADO_LABEL) as Estado[];

interface Orden {
  id: string; numero: string; origen: Origen; estado: Estado;
  producto_nombre: string | null; numero_serie: string | null;
  cliente_nombre: string | null; equipo_descripcion: string | null;
  falla_reportada: string | null; tecnico_nombre: string | null;
  fecha_ingreso: string;
}
interface ProductoOpt { id: string; nombre: string }

function fmt(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("es-PY");
}

export default function TecnicoPage() {
  const [filas, setFilas] = useState<Orden[]>([]);
  const [cargando, setCargando] = useState(true);
  const [q, setQ] = useState("");
  const [filtroOrigen, setFiltroOrigen] = useState<Origen | "">("");
  const [nuevo, setNuevo] = useState(false);
  const [productos, setProductos] = useState<ProductoOpt[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [origen, setOrigen] = useState<Origen>("interno");
  const [productoId, setProductoId] = useState("");
  const [numeroSerie, setNumeroSerie] = useState("");
  const [clienteNombre, setClienteNombre] = useState("");
  const [equipo, setEquipo] = useState("");
  const [falla, setFalla] = useState("");
  const [creando, setCreando] = useState(false);
  // Series disponibles del producto interno elegido, para elegir cuál unidad va al técnico.
  const [seriesDisp, setSeriesDisp] = useState<{ id: string; numero_serie: string }[]>([]);
  const [serieId, setSerieId] = useState("");
  // Orden interna a la que se le está confirmando "listo" (vuelve al stock o no).
  const [confirmListo, setConfirmListo] = useState<Orden | null>(null);

  const reload = useCallback(async () => {
    setCargando(true);
    try {
      const sp = new URLSearchParams();
      if (q.trim()) sp.set("q", q.trim());
      if (filtroOrigen) sp.set("origen", filtroOrigen);
      const r = await fetch(`/api/tecnico?${sp}`, { credentials: "include", cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      setFilas(j?.success ? (j.data.filas ?? []) : []);
    } finally {
      setCargando(false);
    }
  }, [q, filtroOrigen]);

  useEffect(() => { const t = setTimeout(() => void reload(), 250); return () => clearTimeout(t); }, [reload]);

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

  // Al elegir un producto interno, cargar sus series disponibles (en stock) para
  // que el Nº de serie sea un selector, no texto libre.
  useEffect(() => {
    if (origen !== "interno" || !productoId) { setSeriesDisp([]); setSerieId(""); return; }
    let cancel = false;
    (async () => {
      try {
        const r = await fetch(`/api/series?disponibles=1&producto=${productoId}`, { credentials: "include", cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!cancel) {
          setSeriesDisp(j?.success ? (j.data.filas ?? []) : []);
          setSerieId("");
        }
      } catch { if (!cancel) setSeriesDisp([]); }
    })();
    return () => { cancel = true; };
  }, [productoId, origen]);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (creando) return; // evita doble orden por doble clic / doble submit
    setError(null);
    const body: Record<string, unknown> = { origen, falla_reportada: falla.trim() || null };
    if (origen === "interno") {
      if (!productoId) { setError("Elegí el producto interno."); return; }
      body.producto_id = productoId;
      // Si el producto maneja series, se manda la serie elegida (obligatoria).
      if (seriesDisp.length > 0) {
        if (!serieId) { setError("Elegí el número de serie que va al técnico."); return; }
        const s = seriesDisp.find((x) => x.id === serieId);
        body.serie_id = serieId;
        body.numero_serie = s?.numero_serie ?? null;
      }
    } else {
      if (!clienteNombre.trim() && !equipo.trim()) { setError("Indicá el cliente o el equipo."); return; }
      body.cliente_nombre = clienteNombre.trim() || null;
      body.equipo_descripcion = equipo.trim() || null;
      body.numero_serie = numeroSerie.trim() || null;
    }
    setCreando(true);
    try {
      const r = await fetch("/api/tecnico", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) { setError(j?.error ?? "No se pudo crear."); return; }
      setNuevo(false); setProductoId(""); setNumeroSerie(""); setSerieId(""); setSeriesDisp([]);
      setClienteNombre(""); setEquipo(""); setFalla("");
      await reload();
    } finally {
      setCreando(false);
    }
  }

  async function aplicarEstado(o: Orden, estado: Estado, reintegrar: boolean) {
    await fetch("/api/tecnico", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ id: o.id, estado, reintegrar_stock: reintegrar }),
    });
    await reload();
  }

  function cambiarEstado(o: Orden, estado: Estado) {
    // Orden interna marcada "listo": preguntar (con modal propio) si vuelve al stock.
    if (estado === "listo" && o.origen === "interno") {
      setConfirmListo(o);
      return;
    }
    void aplicarEstado(o, estado, false);
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 pb-10 sm:px-6 lg:px-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">En el técnico</h1>
          <p className="text-sm text-slate-600">
            Productos propios dañados de fábrica (salen del stock y vuelven al repararse) y equipos de clientes a reparar.
          </p>
        </div>
        <button onClick={() => setNuevo(!nuevo)} className="shrink-0 rounded-lg bg-[#0EA5E9] px-4 py-2 text-sm font-medium text-white hover:bg-[#0284C7]">
          {nuevo ? "Cerrar" : "+ Nueva orden"}
        </button>
      </div>

      {nuevo && (
        <form onSubmit={crear} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex gap-2">
            <button type="button" onClick={() => setOrigen("interno")}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${origen === "interno" ? "border-sky-300 bg-sky-50 text-sky-700" : "border-slate-200 text-slate-600"}`}>
              Producto interno (dañado de fábrica)
            </button>
            <button type="button" onClick={() => setOrigen("cliente")}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${origen === "cliente" ? "border-sky-300 bg-sky-50 text-sky-700" : "border-slate-200 text-slate-600"}`}>
              Equipo de cliente
            </button>
          </div>

          {origen === "interno" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Producto *</label>
                <BuscadorProducto productos={productos} value={productoId} onChange={setProductoId} />
                <p className="mt-1 text-xs text-slate-500">Se descuenta 1 del stock al enviarlo al técnico.</p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Nº de serie</label>
                {!productoId ? (
                  <input className={`${inputClass} bg-slate-50 text-slate-400`} disabled placeholder="Elegí primero un producto" />
                ) : seriesDisp.length > 0 ? (
                  <>
                    <select className={inputClass} value={serieId} onChange={(e) => setSerieId(e.target.value)}>
                      <option value="">Elegí la unidad…</option>
                      {seriesDisp.map((s) => <option key={s.id} value={s.id}>{s.numero_serie}</option>)}
                    </select>
                    <p className="mt-1 text-xs text-slate-500">{seriesDisp.length} en stock. Elegí cuál va al técnico.</p>
                  </>
                ) : (
                  <input className={`${inputClass} bg-slate-50 text-slate-400`} disabled placeholder="Este producto no maneja series" />
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Cliente</label>
                <input className={inputClass} value={clienteNombre} onChange={(e) => setClienteNombre(e.target.value)} placeholder="Nombre" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Equipo</label>
                <input className={inputClass} value={equipo} onChange={(e) => setEquipo(e.target.value)} placeholder="Ej: TV LG 50″" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Nº de serie</label>
                <input className={inputClass} value={numeroSerie} onChange={(e) => setNumeroSerie(e.target.value)} placeholder="Opcional" />
              </div>
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Falla reportada</label>
            <input className={inputClass} value={falla} onChange={(e) => setFalla(e.target.value)} placeholder="Ej: no enciende" />
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <button type="submit" disabled={creando} className="rounded-lg bg-[#0EA5E9] px-4 py-2 text-sm font-medium text-white hover:bg-[#0284C7] disabled:opacity-50">{creando ? "Creando…" : "Crear orden"}</button>
        </form>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <input className={`${inputClass} max-w-xs`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nº, producto, serie o cliente…" />
          <select className={`${inputClass} w-44`} value={filtroOrigen} onChange={(e) => setFiltroOrigen(e.target.value as Origen | "")}>
            <option value="">Todos los orígenes</option>
            <option value="interno">Producto interno</option>
            <option value="cliente">Equipo de cliente</option>
          </select>
          <span className="ml-auto text-xs text-slate-500">{filas.length} órdenes</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-slate-600">
                <th className="px-3 py-2 font-semibold">N°</th>
                <th className="px-3 py-2 font-semibold">Origen</th>
                <th className="px-3 py-2 font-semibold">Equipo / Producto</th>
                <th className="px-3 py-2 font-semibold">Nº serie</th>
                <th className="px-3 py-2 font-semibold">Falla</th>
                <th className="px-3 py-2 font-semibold">Ingreso</th>
                <th className="px-3 py-2 font-semibold">Estado</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((o) => (
                <tr key={o.id} className="border-b border-slate-50">
                  <td className="px-3 py-2.5 font-mono text-xs text-slate-500">{o.numero}</td>
                  <td className="px-3 py-2.5">
                    <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${o.origen === "interno" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-sky-200 bg-sky-50 text-sky-700"}`}>
                      {o.origen === "interno" ? "Interno" : "Cliente"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-medium text-slate-900">{o.producto_nombre ?? o.equipo_descripcion ?? o.cliente_nombre ?? "—"}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-slate-500">{o.numero_serie ?? "—"}</td>
                  <td className="px-3 py-2.5 text-slate-600">{o.falla_reportada ?? "—"}</td>
                  <td className="px-3 py-2.5 tabular-nums text-slate-500">{fmt(o.fecha_ingreso)}</td>
                  <td className="px-3 py-2.5">
                    <select value={o.estado} onChange={(e) => void cambiarEstado(o, e.target.value as Estado)}
                      className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700">
                      {ESTADOS.map((e) => <option key={e} value={e}>{ESTADO_LABEL[e]}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!cargando && filas.length === 0 && <p className="py-10 text-center text-slate-400">No hay órdenes en el técnico.</p>}
        {cargando && <p className="py-10 text-center text-slate-400">Cargando…</p>}
      </div>

      {confirmListo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tec-dlg-titulo"
          onClick={() => setConfirmListo(null)}
        >
          <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 id="tec-dlg-titulo" className="text-base font-semibold text-slate-900">Marcar como listo</h3>
            <p className="mt-2 text-sm text-slate-600">
              La orden <span className="font-mono">{confirmListo.numero}</span> de{" "}
              <span className="font-medium">{confirmListo.producto_nombre ?? "el producto"}</span> queda lista.
              ¿El producto quedó reparado y vuelve al stock?
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => { const o = confirmListo; setConfirmListo(null); void aplicarEstado(o, "listo", false); }}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                No, solo marcar listo
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => { const o = confirmListo; setConfirmListo(null); void aplicarEstado(o, "listo", true); }}
                className="rounded-lg bg-[#0EA5E9] px-4 py-2 text-sm font-medium text-white hover:bg-[#0284C7]"
              >
                Sí, vuelve al stock
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
