"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import EdgeScrollArea from "@/components/ui/EdgeScrollArea";
import { FancySelect } from "@/components/ui/FancySelect";
import ClienteSelectorBuscador from "@/components/clientes/ClienteSelectorBuscador";
import MobileFab from "@/components/ui/MobileFab";
import { getVentas } from "@/lib/ventas/storage";
import PedidosPendientesCaja from "./PedidosPendientesCaja";
import PedidosConsultaPendientes from "./PedidosConsultaPendientes";
import CajaControlPanel from "@/components/caja/CajaControlPanel";
import DevolucionWizard from "@/components/devoluciones/DevolucionWizard";
import { productoMatchesQuery } from "@/lib/productos/token-search";
import type { Venta, TipoVenta, TipoIvaVenta } from "@/lib/ventas/types";

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatGs(valor: number) {
  return `Gs. ${Math.round(valor).toLocaleString("es-PY")}`;
}

function formatFecha(iso: string) {
  try {
    const d    = new Date(iso);
    const dd   = String(d.getDate()).padStart(2, "0");
    const mm   = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    const hh   = String(d.getHours()).padStart(2, "0");
    const min  = String(d.getMinutes()).padStart(2, "0");
    return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
  } catch {
    return iso;
  }
}

// ── Constantes de estilo ───────────────────────────────────────────────────────

const inputFilterClass =
  "border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none";

const tipoVentaBadge: Record<TipoVenta, string> = {
  CONTADO: "bg-blue-50 text-blue-700",
  CREDITO: "bg-orange-50 text-orange-700",
};

const ivaLabel: Record<TipoIvaVenta, string> = {
  EXENTA: "Exenta",
  "5%":   "IVA 5%",
  "10%":  "IVA 10%",
};


// ── Helpers de fila ───────────────────────────────────────────────────────────

/** Muestra el primer producto de la venta y un badge con el resto. */
function ResumenProductos({ v }: { v: Venta }) {
  const primero = v.items[0];
  if (!primero) {
    return (
      <span className="text-xs text-gray-400">Sin líneas cargadas</span>
    );
  }
  const extra   = v.items.length - 1;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-medium text-gray-800 leading-tight">
        {primero.producto_nombre}
      </span>
      <div className="flex items-center gap-2 mt-0.5">
        <span className="font-mono text-xs text-gray-400">{primero.sku}</span>
        {extra > 0 && (
          <span className="bg-gray-100 text-gray-500 text-xs px-1.5 py-0.5 rounded-full font-medium">
            +{extra} más
          </span>
        )}
      </div>
    </div>
  );
}

/** Determina qué mostrar en la celda IVA cuando hay múltiples ítems. */
function ivaResumen(v: Venta): string {
  const tipos = [...new Set(v.items.map((i) => i.tipo_iva))];
  if (tipos.length === 1) return ivaLabel[tipos[0]];
  return "Mixto";
}

// ── Componente principal ───────────────────────────────────────────────────────

export default function VentasPage() {
  const [todas,      setTodas]      = useState<Venta[]>([]);
  const [busqueda,   setBusqueda]   = useState("");
  const [filtroTipo, setFiltroTipo] = useState<TipoVenta | "">("");
  const [filtroIva,  setFiltroIva]  = useState<TipoIvaVenta | "">("");
  const [mostrarAnuladas, setMostrarAnuladas] = useState(true);
  const [detalle,    setDetalle]    = useState<Venta | null>(null);
  const [anularTarget, setAnularTarget] = useState<Venta | null>(null);
  const [editarTarget, setEditarTarget] = useState<Venta | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [reimprimiendoId, setReimprimiendoId] = useState<string | null>(null);
  const [cambiarTarget, setCambiarTarget] = useState<Venta | null>(null);
  const [devolucionesOn, setDevolucionesOn] = useState(false);
  const [devolverVentaId, setDevolverVentaId] = useState<string | null>(null);
  // El usuario Armando (armando@admin.com) no edita ventas: se le oculta el botón "Editar".
  const [ocultarEditar, setOcultarEditar] = useState(false);
  // Aviso (descartable) para mantener la numeración del sistema en sincronía con el
  // talonario físico: si un comprobante sale mal hay que anular la venta ANTES de
  // reimprimir. Se recuerda la elección en localStorage.
  const [avisoNumeracion, setAvisoNumeracion] = useState(false);

  useEffect(() => {
    try { setAvisoNumeracion(localStorage.getItem("aviso_numeracion_preimpresa") !== "off"); }
    catch { setAvisoNumeracion(true); }
  }, []);
  const cerrarAvisoNumeracion = () => {
    setAvisoNumeracion(false);
    try { localStorage.setItem("aviso_numeracion_preimpresa", "off"); } catch { /* modo privado: igual se oculta esta sesión */ }
  };

  useEffect(() => {
    let cancelled = false;
    fetch("/api/usuarios/me", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const email = String(j?.usuario?.email ?? "").trim().toLowerCase();
        setOcultarEditar(email === "armando@admin.com");
      })
      .catch(() => { if (!cancelled) setOcultarEditar(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/devoluciones/flag", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setDevolucionesOn(j?.data?.enabled === true); })
      .catch(() => { if (!cancelled) setDevolucionesOn(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getVentas().then((data) => {
      if (cancelled) return;
      const ordenadas = [...data].sort((a, b) => {
        const ta = new Date(a.fecha).getTime();
        const tb = new Date(b.fecha).getTime();
        return tb - ta || b.numero_control.localeCompare(a.numero_control);
      });
      setTodas(ordenadas);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // "La factura salió mal → reimprimir en hoja nueva": anula el número actual de
  // la venta y toma el siguiente del talonario, para reimprimir en una hoja física
  // nueva sin desfasar el correlativo. Solo numeración (no toca stock/caja/ítems).
  async function reimprimirNuevaHoja(v: Venta) {
    if (reimprimiendoId) return;
    if (!window.confirm(
      `¿La factura ${v.numero_factura ?? ""} salió mal?\n\n` +
      `Se ANULA ese número (la hoja física se archiva anulada) y la venta toma el SIGUIENTE ` +
      `número del talonario para reimprimir en una hoja nueva.\n\n¿Continuar?`
    )) return;
    setReimprimiendoId(v.id);
    try {
      const res = await fetch(`/api/ventas/${v.id}/factura-preimpresa/rehacer`, { method: "POST", credentials: "include" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j?.success === false) { alert(j?.error ?? "No se pudo reimprimir en hoja nueva."); return; }
      // Abre la factura para imprimir en la hoja nueva (con el número ya avanzado).
      try { window.open(`/api/ventas/${v.id}/factura-preimpresa`, "_blank", "noopener"); } catch {}
      setReloadKey((k) => k + 1);
    } finally {
      setReimprimiendoId(null);
    }
  }

  const filtradas = todas.filter((v) => {
    // Anuladas ocultas por defecto (toggle "Ver anuladas" las muestra).
    if (!mostrarAnuladas && v.estado === "anulada") return false;
    // Búsqueda por tokens: número de control, nombre del cliente, y nombre o SKU de cualquier ítem.
    if (busqueda.trim() !== "" && !productoMatchesQuery(
      busqueda,
      v.numero_control,
      v.cliente_nombre ?? "",
      ...v.items.map((i) => i.producto_nombre),
      ...v.items.map((i) => i.sku),
    )) return false;
    // Tipo de venta
    if (filtroTipo !== "" && v.tipo_venta !== filtroTipo) return false;
    // IVA: coincide si al menos un ítem tiene ese tipo
    if (filtroIva !== "" && !v.items.some((i) => i.tipo_iva === filtroIva))
      return false;
    return true;
  });

  const hayFiltros = busqueda || filtroTipo || filtroIva || mostrarAnuladas;

  return (
    <div className="space-y-8">

      <div>
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-1.5 w-1.5 rounded-full bg-[#4FAEB2]"
            style={{ boxShadow: "0 0 0 3px rgba(79, 174, 178, 0.18)" }}
          />
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">
            Zentra · Operaciones
          </p>
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-900">Caja</h1>
            <p className="mt-0.5 text-xs text-slate-500">Cobro, facturación y cierre de pedidos</p>
          </div>
          {devolucionesOn && (
            <Link
              href="/ventas/devoluciones"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
            >
              Devoluciones
            </Link>
          )}
        </div>
      </div>

      <CajaControlPanel />

      <PedidosConsultaPendientes />
      <PedidosPendientesCaja />


      {/* ── Tabla de ventas ───────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-[#4FAEB2]/15 sm:p-5 lg:p-6">

        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Órdenes de venta</h2>
          <Link
            href="/ventas/nueva"
            className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm"
          >
            + Nueva venta
          </Link>
        </div>

        {/* Aviso: mantener la numeración del sistema igual al talonario físico. */}
        {avisoNumeracion && (
          <div className="mb-5 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <span className="text-lg leading-none">💡</span>
            <div className="flex-1 text-xs text-amber-800">
              <p className="font-semibold">Para que el N.º de factura coincida con el talonario físico:</p>
              <p className="mt-0.5">
                Si un comprobante <b>salió mal, anulá la venta acá</b> antes de reimprimir, y facturá <b>de a una por vez</b> en orden. El número anulado no se reutiliza.
              </p>
            </div>
            <button
              type="button"
              onClick={cerrarAvisoNumeracion}
              className="shrink-0 rounded p-1 text-amber-500 transition-colors hover:bg-amber-100"
              title="Entendido, no mostrar más"
              aria-label="Cerrar aviso"
            >
              ✕
            </button>
          </div>
        )}

        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-3 mb-5 pb-5 border-b border-gray-100">
          <input
            type="text"
            placeholder="Buscar por número, cliente, producto o SKU..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className={`${inputFilterClass} min-w-0 flex-1 sm:min-w-64`}
          />
          <FancySelect
            value={filtroTipo}
            onChange={(v) => setFiltroTipo(v as TipoVenta | "")}
            ariaLabel="Filtrar por tipo de venta"
            className="w-44"
            size="sm"
            options={[
              { value: "", label: "Todos los tipos" },
              { value: "CONTADO", label: "Contado" },
              { value: "CREDITO", label: "Crédito" },
            ]}
          />
          <FancySelect
            value={filtroIva}
            onChange={(v) => setFiltroIva(v as TipoIvaVenta | "")}
            ariaLabel="Filtrar por IVA"
            className="w-44"
            size="sm"
            options={[
              { value: "", label: "Todos los IVA" },
              { value: "EXENTA", label: "Exenta" },
              { value: "5%", label: "IVA 5%" },
              { value: "10%", label: "IVA 10%" },
            ]}
          />
          <label className="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={mostrarAnuladas}
              onChange={(e) => setMostrarAnuladas(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-[#4FAEB2] focus:ring-[#4FAEB2]"
            />
            Ver anuladas
          </label>
          {hayFiltros && (
            <button
              onClick={() => { setBusqueda(""); setFiltroTipo(""); setFiltroIva(""); setMostrarAnuladas(false); }}
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors px-2"
            >
              Limpiar filtros
            </button>
          )}
          <span className="ml-auto text-sm text-gray-400">
            {filtradas.length} de {todas.length} ventas
          </span>
        </div>

        {/* Tabla — min-w fuerza scroll horizontal en mobile; columnas secundarias
            (Items, Cant total, IVA, Pago) se ocultan progresivamente. */}
        <EdgeScrollArea>
          <table className="w-full min-w-[760px] lg:min-w-0 text-left text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-600 text-sm font-semibold">
                <th className="py-3 pr-4 font-medium">Número de factura</th>
                <th className="py-3 pr-4 font-medium">Productos</th>
                <th className="hidden py-3 pr-4 text-center font-medium lg:table-cell">Ítems</th>
                <th className="py-3 pr-4 font-medium text-right hidden lg:table-cell">Cant. total</th>
                <th className="py-3 pr-4 font-medium hidden lg:table-cell">IVA</th>
                <th className="py-3 pr-4 font-medium text-right">Total</th>
                <th className="hidden py-3 pr-4 font-medium lg:table-cell">Tipo</th>
                <th className="hidden py-3 pr-4 font-medium lg:table-cell">Pago</th>
                <th className="hidden py-3 pr-4 font-medium lg:table-cell">Vendedor</th>
                <th className="py-3 pr-4 font-medium">Fecha</th>
                <th className="py-3 font-medium text-center">Ticket</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-gray-400">
                    {todas.length === 0
                      ? "No hay ventas registradas"
                      : "Ninguna venta coincide con los filtros"}
                  </td>
                </tr>
              ) : (
                filtradas.map((v) => {
                  const cantTotal = v.items.reduce((s, i) => s + i.cantidad, 0);
                  const isAnulada = v.estado === "anulada";
                  return (
                    <tr
                      key={v.id}
                      onClick={() => setDetalle(v)}
                      className={`border-b border-slate-200 last:border-0 transition-colors cursor-pointer ${
                        isAnulada ? "bg-red-50/40 text-slate-400 line-through hover:bg-red-50/60" : "hover:bg-[#4FAEB2]/[0.04]"
                      }`}
                    >
                      <td className="py-4 pr-4 font-mono text-xs text-gray-500 align-middle">
                        <div className="flex items-center gap-1.5">
                          {v.numero_factura ? (
                            <span>{v.numero_factura}</span>
                          ) : (
                            <span className="font-sans italic text-slate-400 normal-case">Sin factura</span>
                          )}
                          {isAnulada && (
                            <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700 no-underline">
                              Anulada
                            </span>
                          )}
                          {v.estado === "devuelta_total" && (
                            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 no-underline">
                              Devuelta
                            </span>
                          )}
                          {v.estado === "parcialmente_devuelta" && (
                            <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 no-underline">
                              Dev. parcial
                            </span>
                          )}
                        </div>
                        {v.cliente_nombre && (
                          <div className="mt-1 font-sans text-[11px] font-medium text-slate-600 normal-case truncate max-w-[160px]" title={v.cliente_nombre}>
                            {v.cliente_nombre}
                          </div>
                        )}
                      </td>
                      <td className="py-4 pr-4 align-middle">
                        <ResumenProductos v={v} />
                      </td>
                      <td className="hidden py-4 pr-4 text-center align-middle lg:table-cell">
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-xs font-semibold text-gray-600">
                          {v.items.length}
                        </span>
                      </td>
                      <td className="py-4 pr-4 text-right tabular-nums text-gray-700 align-middle hidden lg:table-cell">
                        {cantTotal}
                      </td>
                      <td className="py-4 pr-4 align-middle hidden lg:table-cell">
                        <span className="px-2 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700">
                          {ivaResumen(v)}
                        </span>
                      </td>
                      <td className="py-4 pr-4 text-right tabular-nums font-semibold text-gray-800 align-middle">
                        {formatGs(v.total)}
                      </td>
                      <td className="hidden py-4 pr-4 align-middle lg:table-cell">
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${tipoVentaBadge[v.tipo_venta]}`}>
                          {v.tipo_venta === "CONTADO"
                            ? "Contado"
                            : `Crédito ${v.plazo_dias ?? ""}d`}
                        </span>
                      </td>
                      <td className="hidden py-4 pr-4 align-middle text-xs text-gray-600 lg:table-cell">
                        {v.metodo_pago === "mixto" ? (
                          <span className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700">
                            Mixto
                          </span>
                        ) : v.metodo_pago === "tarjeta" ? "Tarjeta"
                          : v.metodo_pago === "transferencia" ? "Transfer."
                          : v.metodo_pago === "efectivo" ? "Efectivo"
                          : "—"}
                      </td>
                      <td className="hidden py-4 pr-4 align-middle text-xs text-gray-600 lg:table-cell">
                        {v.vendedor_nombre ?? v.usuario_nombre ?? "—"}
                      </td>
                      <td className="py-4 pr-4 text-gray-500 text-xs tabular-nums align-middle">
                        {formatFecha(v.fecha)}
                      </td>
                      <td className="py-4 text-center align-middle" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex items-center gap-1.5">
                          {devolucionesOn && !isAnulada && v.estado !== "devuelta_total" && !v.origen_guarda && (
                            <button
                              type="button"
                              onClick={() => setDevolverVentaId(v.id)}
                              className="inline-flex items-center justify-center rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100"
                              title="Ver detalle y registrar una devolución"
                            >
                              {v.estado === "parcialmente_devuelta" ? "Devolver más" : "Devolver"}
                            </button>
                          )}
                          <a
                            href={`/api/ventas/${v.id}/comprobante-a4`}
                            target="_blank"
                            rel="noopener"
                            className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 transition-colors"
                            title="Abrir comprobante A4 imprimible"
                          >
                            Imprimir
                          </a>
                          <a
                            href={`/api/ventas/${v.id}/factura-preimpresa`}
                            target="_blank"
                            rel="noopener"
                            className="inline-flex items-center justify-center rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 transition-colors"
                            title="Imprimir sobre la factura preimpresa de ASUNHOME (solo los datos, 3 copias). Agregá ?calibrar=1 en dev para ver la plantilla de fondo."
                          >
                            Factura preimpresa
                          </a>
                          {/* Reimprimir en hoja nueva: solo si ya tiene número (se imprimió) y no está anulada. */}
                          {v.numero_factura && !isAnulada && (
                            <button
                              type="button"
                              onClick={() => reimprimirNuevaHoja(v)}
                              disabled={reimprimiendoId === v.id}
                              title="La factura salió mal: anula este número (la hoja física queda anulada) y toma el siguiente del talonario para reimprimir en una hoja nueva."
                              className="inline-flex items-center justify-center rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {reimprimiendoId === v.id ? "Reimprimiendo…" : "Reimprimir en hoja nueva"}
                            </button>
                          )}
                          {/* Puente venta→factura: si la venta tiene factura ERP, link al
                              detalle /facturas/[id] (panel SIFEN: firma/envío/KUDE). */}
                          {v.factura_id && (
                            <Link
                              href={`/facturas/${v.factura_id}`}
                              className="inline-flex items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
                              title={
                                v.factura_estado_sifen
                                  ? `Factura ${v.numero_factura ?? ""} · SIFEN: ${v.factura_estado_sifen}`
                                  : `Factura ${v.numero_factura ?? ""}`
                              }
                            >
                              {v.numero_factura ? `Factura ${v.numero_factura}` : "Factura"}
                            </Link>
                          )}
                          {v.genera_nota_remision && (
                            <a
                              href={`/api/ventas/${v.id}/ticket?tipo=remision`}
                              target="_blank"
                              rel="noopener"
                              className="inline-flex items-center justify-center rounded-md border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100 transition-colors"
                              title="Nota de remisión (documento no fiscal)"
                            >
                              Nota de remisión
                            </a>
                          )}
                          {!isAnulada && !ocultarEditar && (
                            <button
                              type="button"
                              onClick={() => setEditarTarget(v)}
                              className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 transition-colors"
                              title="Editar datos de la venta (cliente y observaciones). No cambia productos ni montos."
                            >
                              Editar
                            </button>
                          )}
                          {!isAnulada && !ocultarEditar && (
                            <button
                              type="button"
                              onClick={() => setCambiarTarget(v)}
                              className="inline-flex items-center justify-center rounded-md border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-medium text-purple-700 hover:bg-purple-100 transition-colors"
                              title="Cambiar un producto de la venta por otro (ajusta stock, IVA, total y caja). Mantiene el mismo número de factura."
                            >
                              Cambiar producto
                            </button>
                          )}
                          {!isAnulada && !v.origen_guarda && (
                            <button
                              type="button"
                              onClick={() => setAnularTarget(v)}
                              className="inline-flex items-center justify-center rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 transition-colors"
                              title={
                                v.estado === "devuelta_total" || v.estado === "parcialmente_devuelta"
                                  ? "Anular la operación completa (venta + devolución)"
                                  : "Anular venta y revertir stock"
                              }
                            >
                              Anular
                            </button>
                          )}
                          {v.origen_guarda && (
                            <span
                              className="inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700"
                              title="Esta venta proviene de una guarda y debe gestionarse desde la guarda para evitar alterar incorrectamente el stock."
                            >
                              Desde guarda
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </EdgeScrollArea>

      </div>

      {/* FAB mobile: acceso 1-tap a "+ Nueva venta" desde cualquier scroll position */}
      <MobileFab href="/ventas/nueva" label="Nueva venta" />

      {detalle && <VentaDetalleModal venta={detalle} onClose={() => setDetalle(null)} />}

      {devolucionesOn && devolverVentaId && (
        <DevolucionWizard
          ventaId={devolverVentaId}
          onClose={() => setDevolverVentaId(null)}
          onDone={(devId) => {
            setDevolverVentaId(null);
            try { window.open(`/api/devoluciones/${devId}/comprobante?auto=1`, "_blank", "noopener"); } catch {}
            setReloadKey((k) => k + 1);
          }}
        />
      )}
      {anularTarget && (
        <AnularVentaModal
          venta={anularTarget}
          onClose={() => setAnularTarget(null)}
          onDone={() => {
            setAnularTarget(null);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
      {editarTarget && (
        <EditarVentaModal
          venta={editarTarget}
          onClose={() => setEditarTarget(null)}
          onDone={() => {
            setEditarTarget(null);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
      {cambiarTarget && (
        <CambiarProductoModal
          venta={cambiarTarget}
          onClose={() => setCambiarTarget(null)}
          onDone={() => {
            setCambiarTarget(null);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

function AnularVentaModal({
  venta,
  onClose,
  onDone,
}: {
  venta: Venta;
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
      const res = await fetch(`/api/ventas/${venta.id}/anular`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: motivo.trim() || null }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error ?? `Error ${res.status}`);
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo anular la venta.");
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
          <h3 className="text-base font-bold text-red-800">Anular venta {venta.numero_control}</h3>
          <p className="mt-1 text-xs text-red-700">
            {venta.estado === "devuelta_total" || venta.estado === "parcialmente_devuelta"
              ? "Se van a anular también las devoluciones asociadas, revirtiendo stock y caja para dejar todo como antes de la operación. Esta acción no se puede deshacer."
              : "Se va a devolver el stock al inventario y revertir el movimiento de caja de esta venta. Esta acción no se puede deshacer."}
          </p>
        </div>
        <div className="p-5 space-y-3">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Motivo (opcional)</span>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej: error de carga, cliente devolvió, etc."
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
              {loading ? "Anulando..." : "Anular venta"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Modal de edición de datos de venta ──────────────────────────────────────────
// Edita SOLO cliente y observaciones. Nunca ítems, cantidades, montos ni método de
// pago (eso afectaría stock y caja). Coincide con el endpoint PATCH /api/ventas/[id].

function EditarVentaModal({
  venta,
  onClose,
  onDone,
}: {
  venta: Venta;
  onClose: () => void;
  onDone: () => void;
}) {
  const [clienteId, setClienteId] = useState<string>(venta.cliente_id ?? "");
  const [clienteLabel, setClienteLabel] = useState<string>(venta.cliente_nombre ?? "");
  const [observaciones, setObservaciones] = useState<string>(venta.observaciones ?? "");
  const [vendedores, setVendedores] = useState<{ id: string; nombre: string }[]>([]);
  const [vendedorId, setVendedorId] = useState<string>(venta.vendedor_id ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // N.º de factura preimpresa (editable para mantener el correlativo). Solo se
  // muestra si la venta ya tiene número. Se edita la parte numérica (secuencia).
  const numeroFacturaActual = venta.numero_factura ?? "";
  const numeroPrefijo = numeroFacturaActual.includes("-")
    ? numeroFacturaActual.split("-").slice(0, -1).join("-") + "-"
    : "";
  const seqActual = (() => {
    const last = numeroFacturaActual.split("-").pop() ?? "";
    const n = parseInt(last.replace(/\D/g, ""), 10);
    return Number.isFinite(n) && n > 0 ? String(n) : "";
  })();
  const [numeroSeq, setNumeroSeq] = useState<string>(seqActual);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const rv = await fetch("/api/comisiones/vendedores", { credentials: "include", cache: "no-store" });
        const jv = await rv.json();
        if (vivo && rv.ok && jv?.success && Array.isArray(jv.data?.vendedores)) {
          setVendedores((jv.data.vendedores as { id: string; nombre: string }[]).map((v) => ({ id: v.id, nombre: v.nombre })));
        }
      } catch {
        /* si falla, queda solo el vendedor actual */
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      // 1) N.º de factura (si cambió y la venta tiene número). Se hace primero
      //    porque valida rango/duplicado; si falla, no se toca el resto.
      if (numeroFacturaActual && numeroSeq && numeroSeq !== seqActual) {
        const rN = await fetch(`/api/ventas/${venta.id}/factura-preimpresa/numero`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ numero_secuencia: Number(numeroSeq) }),
        });
        const jN = await rN.json().catch(() => ({}));
        if (!rN.ok || jN?.success === false) throw new Error(jN?.error ?? "No se pudo editar el número de factura.");
      }
      // 2) Resto de campos seguros (cliente / observaciones / vendedor).
      const res = await fetch(`/api/ventas/${venta.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente_id: clienteId || null,
          observaciones: observaciones.trim() || null,
          vendedor_id: vendedorId || null,
          vendedor_nombre: vendedores.find((v) => v.id === vendedorId)?.nombre ?? null,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? `Error ${res.status}`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo editar la venta.");
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
        className="w-full max-w-md overflow-hidden rounded-2xl border-2 border-[#4FAEB2]/20 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-100 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent px-5 py-4">
          <h3 className="text-base font-bold text-slate-800">Editar venta {venta.numero_control}</h3>
          <p className="mt-1 text-xs text-slate-500">
            Cambia el cliente, el vendedor, las observaciones y el N.º de factura. No modifica productos, cantidades ni montos.
          </p>
        </div>
        <div className="p-5 space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Cliente</span>
            <div className="mt-1">
              <ClienteSelectorBuscador
                value={clienteId}
                label={clienteLabel}
                onChange={(id, cliente) => { setClienteId(id); setClienteLabel(cliente?.nombre ?? ""); }}
                placeholder="Buscar por nombre o cédula…"
              />
            </div>
          </label>
          {vendedores.length > 0 && (
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Vendedor</span>
              <div className="mt-1">
                <FancySelect
                  value={vendedorId}
                  onChange={(v) => setVendedorId(v)}
                  options={[
                    { value: "", label: "— Sin vendedor —" },
                    ...vendedores.map((v) => ({ value: v.id, label: v.nombre })),
                  ]}
                  placeholder="Elegir vendedor…"
                />
              </div>
              <span className="mt-1 block text-[11px] text-slate-500">Cambia a quién se le acredita la comisión de esta venta.</span>
            </label>
          )}
          {numeroFacturaActual && (
            <label className="block">
              <span className="text-sm font-medium text-slate-700">N.º de factura</span>
              <div className="mt-1 flex items-center gap-2">
                <span className="font-mono text-sm text-slate-500">{numeroPrefijo}</span>
                <input
                  value={numeroSeq}
                  onChange={(e) => setNumeroSeq(e.target.value.replace(/\D/g, "").slice(0, 7))}
                  inputMode="numeric"
                  className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 outline-none"
                  disabled={loading}
                />
              </div>
              <span className="mt-1 block text-[11px] text-slate-500">
                Editá solo si necesitás corregir el correlativo. No puede repetir un número ya usado.
              </span>
            </label>
          )}
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Observaciones</span>
            <textarea
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              placeholder="Datos de facturación, nota interna, etc."
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 outline-none"
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
              className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-bold text-white hover:bg-[#3F8E91] disabled:opacity-50"
            >
              {loading ? "Guardando..." : "Guardar cambios"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Modal de detalle de venta ───────────────────────────────────────────────────

function VentaDetalleModal({ venta, onClose }: { venta: Venta; onClose: () => void }) {
  const cantTotal = venta.items.reduce((s, i) => s + i.cantidad, 0);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl border-2 border-[#4FAEB2]/20 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent px-5 py-4">
          <div>
            <h3 className="font-mono text-sm font-bold text-[#3F8E91]">{venta.numero_control}</h3>
            <p className="mt-0.5 text-xs text-slate-500">Detalle de la venta</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        {/* Meta: fecha/hora, vendedor, tipo, pago */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 py-4 sm:grid-cols-4">
          <Meta label="Fecha y hora" value={formatFecha(venta.fecha)} />
          <Meta label="Vendedor" value={venta.vendedor_nombre ?? venta.usuario_nombre ?? "—"} />
          <Meta
            label="Tipo"
            value={venta.tipo_venta === "CONTADO" ? "Contado" : `Crédito ${venta.plazo_dias ?? ""}d`}
          />
          <Meta
            label="Pago"
            value={
              venta.metodo_pago === "mixto" ? "Mixto"
              : venta.metodo_pago === "tarjeta" ? "Tarjeta"
              : venta.metodo_pago === "transferencia" ? "Transferencia"
              : venta.metodo_pago === "efectivo" ? "Efectivo"
              : "—"
            }
          />
        </div>

        {/* Ítems */}
        <div className="max-h-[50vh] overflow-y-auto px-5 pb-2">
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Producto</th>
                  <th className="px-3 py-2 text-center font-semibold">Cant.</th>
                  <th className="px-3 py-2 text-right font-semibold">P. Unit.</th>
                  <th className="px-3 py-2 text-center font-semibold">IVA</th>
                  <th className="px-3 py-2 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {venta.items.map((it, idx) => (
                  <tr key={`${it.producto_id}-${idx}`}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">{it.producto_nombre}</div>
                      <div className="font-mono text-xs text-slate-400">{it.sku}</div>
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums text-slate-700">{it.cantidad}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{formatGs(it.precio_venta)}</td>
                    <td className="px-3 py-2 text-center text-xs text-slate-500">{ivaLabel[it.tipo_iva]}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-800">{formatGs(it.total_linea)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Totales */}
        <div className="border-t border-slate-100 px-5 py-4">
          <div className="ml-auto max-w-xs space-y-1 text-sm">
            <Fila label={`Subtotal (${venta.items.length} ítem(s), ${cantTotal} u.)`} value={formatGs(venta.subtotal)} />
            <Fila label="IVA" value={formatGs(venta.monto_iva)} />
            <div className="mt-1 flex items-center justify-between border-t border-slate-200 pt-2 text-base font-bold text-slate-900">
              <span>Total</span>
              <span className="tabular-nums">{formatGs(venta.total)}</span>
            </div>
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

function Fila({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-slate-600">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

// ── Modal: cambiar un producto de la venta por otro (ajusta stock/IVA/total/caja) ──

type ProdHit = { id: string; nombre: string; sku: string; precio_venta: number; stock_actual: number };

function CambiarProductoModal({ venta, onClose, onDone }: { venta: Venta; onClose: () => void; onDone: () => void }) {
  const items = venta.items ?? [];
  const [itemId, setItemId] = useState<string>(items[0]?.id ?? "");
  const itemSel = items.find((i) => i.id === itemId) ?? items[0];

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ProdHit[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [nuevo, setNuevo] = useState<ProdHit | null>(null);
  const [cantidad, setCantidad] = useState<number>(itemSel?.cantidad ?? 1);
  const [precio, setPrecio] = useState<number>(0);
  const [tipoIva, setTipoIva] = useState<TipoIvaVenta>((itemSel?.tipo_iva as TipoIvaVenta) ?? "10%");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Búsqueda de productos (debounce).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setHits([]); return; }
    let vivo = true;
    setBuscando(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/productos?q=${encodeURIComponent(q)}&limit=20`, { credentials: "include", cache: "no-store" });
        const j = await r.json();
        if (!vivo) return;
        const arr = (j?.productos ?? j?.data?.productos ?? []) as ProdHit[];
        setHits(Array.isArray(arr) ? arr.slice(0, 20) : []);
      } catch { if (vivo) setHits([]); }
      finally { if (vivo) setBuscando(false); }
    }, 250);
    return () => { vivo = false; clearTimeout(t); };
  }, [query]);

  function elegir(p: ProdHit) {
    setNuevo(p);
    setPrecio(Number(p.precio_venta) || 0);
    setHits([]);
    setQuery("");
  }

  const totalLineaNuevo = Math.round((cantidad || 0) * (precio || 0));
  const totalVentaNuevo = venta.total - (itemSel?.total_linea ?? 0) + totalLineaNuevo;
  const diferencia = totalVentaNuevo - venta.total;
  const gs = (n: number) => `Gs. ${Math.round(n).toLocaleString("es-PY")}`;

  async function submit() {
    if (!itemSel?.id) { setError("No se pudo identificar el producto a cambiar. Refrescá la página."); return; }
    if (!nuevo) { setError("Elegí el producto nuevo."); return; }
    if (!(cantidad > 0)) { setError("La cantidad debe ser mayor a 0."); return; }
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/ventas/${venta.id}/cambiar-producto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: itemSel.id, nuevo_producto_id: nuevo.id, cantidad, precio_venta: precio, tipo_iva: tipoIva }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.success === false) throw new Error(j?.error ?? "No se pudo cambiar el producto.");
      const dif = Number(j?.diferencia ?? diferencia);
      const msg = dif > 0 ? `Cobrá ${gs(dif)} más al cliente.` : dif < 0 ? `Devolvé ${gs(-dif)} al cliente.` : "Sin diferencia de importe.";
      alert(`Producto cambiado. ${msg}`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cambiar el producto.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl border-2 border-purple-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-slate-100 bg-gradient-to-r from-purple-50 to-transparent px-5 py-4">
          <h3 className="text-base font-bold text-slate-800">Cambiar producto · {venta.numero_control}</h3>
          <p className="mt-1 text-xs text-slate-500">Ajusta stock, IVA y total, y la caja del día. Mantiene el mismo N.º de factura.</p>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-5 space-y-4">
          {items.length > 1 && (
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Producto a cambiar</span>
              <select value={itemId} onChange={(e) => setItemId(e.target.value)} disabled={loading}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white outline-none focus:border-purple-400">
                {items.map((i) => (
                  <option key={i.id ?? i.producto_id} value={i.id ?? ""}>{i.producto_nombre} — {gs(i.total_linea)}</option>
                ))}
              </select>
            </label>
          )}
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Actual: <b>{itemSel?.producto_nombre}</b> · {itemSel?.cantidad} × {gs(itemSel?.precio_venta ?? 0)} = {gs(itemSel?.total_linea ?? 0)}
          </div>

          {!nuevo ? (
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Nuevo producto</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre o SKU…" disabled={loading}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-purple-400" />
              {buscando && <p className="mt-1 text-[11px] text-slate-400">Buscando…</p>}
              {hits.length > 0 && (
                <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                  {hits.map((p) => (
                    <button key={p.id} type="button" onClick={() => elegir(p)}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-purple-50">
                      <span className="font-medium text-slate-800">{p.nombre}</span>
                      <span className="block text-[11px] text-slate-500">{p.sku} · {gs(p.precio_venta)} · stock {p.stock_actual}</span>
                    </button>
                  ))}
                </div>
              )}
            </label>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border border-purple-200 bg-purple-50 px-3 py-2">
                <span className="text-sm font-semibold text-purple-800">{nuevo.nombre}</span>
                <button type="button" onClick={() => setNuevo(null)} className="text-xs text-purple-600 hover:underline">Cambiar</button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className="block">
                  <span className="text-[11px] font-medium text-slate-600">Cantidad</span>
                  <input type="number" min={1} value={cantidad} onChange={(e) => setCantidad(Math.max(1, Math.trunc(Number(e.target.value) || 0)))} disabled={loading}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-right text-sm outline-none focus:border-purple-400" />
                </label>
                <label className="block">
                  <span className="text-[11px] font-medium text-slate-600">Precio</span>
                  <input type="number" min={0} value={precio} onChange={(e) => setPrecio(Math.max(0, Number(e.target.value) || 0))} disabled={loading}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-right text-sm outline-none focus:border-purple-400" />
                </label>
                <label className="block">
                  <span className="text-[11px] font-medium text-slate-600">IVA</span>
                  <select value={tipoIva} onChange={(e) => setTipoIva(e.target.value as TipoIvaVenta)} disabled={loading}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm bg-white outline-none focus:border-purple-400">
                    <option value="10%">10%</option>
                    <option value="5%">5%</option>
                    <option value="EXENTA">Exenta</option>
                  </select>
                </label>
              </div>
              <div className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <Fila label="Total nuevo de la línea" value={gs(totalLineaNuevo)} />
                <Fila label="Total nuevo de la venta" value={gs(totalVentaNuevo)} />
                <div className={`mt-1 flex items-center justify-between font-semibold ${diferencia > 0 ? "text-emerald-700" : diferencia < 0 ? "text-rose-700" : "text-slate-600"}`}>
                  <span>{diferencia > 0 ? "A cobrar" : diferencia < 0 ? "A devolver" : "Diferencia"}</span>
                  <span className="tabular-nums">{gs(Math.abs(diferencia))}</span>
                </div>
              </div>
            </div>
          )}

          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} disabled={loading}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
            <button type="button" onClick={submit} disabled={loading || !nuevo}
              className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-bold text-white hover:bg-purple-700 disabled:opacity-50">
              {loading ? "Guardando…" : "Cambiar producto"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
