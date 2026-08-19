"use client";

/**
 * /pedidos — Listado principal del modulo Pedidos.
 *
 * Vista unificada para vendedor + caja:
 * - Filtros por estado (pendiente, en_caja, facturado, cancelado, todos).
 * - Buscador por numero, cliente, vendedor.
 * - Toggle 'Solo mios' para vendedor.
 * - Acciones por fila (gestion; el cobro vive en la Caja /ventas):
 *     pendiente  -> Ver, Editar (vendedor), Cancelar
 *     en_caja    -> Ver, Liberar, Cancelar
 *     facturado  -> Ver venta
 *     cancelado  -> (solo lectura)
 * - Boton CTA "+ Nuevo pedido" -> /pedidos/nuevo
 *
 * El cobro/facturacion se hace desde la Caja (/ventas), que muestra el
 * listado "Pedidos por cobrar" embebido.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  Plus,
  X,
  Clock,
  CheckCircle2,
  XCircle,
  Lock,
  Receipt,
  Eye,
  Pencil,
  Trash2,
  Unlock,
  Send,
} from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import type { EstadoPedidoCaja } from "@/lib/pedidos-caja/types";

type PedidoLite = {
  id: string;
  numero: string | null;
  titulo: string;
  cliente_nombre: string | null;
  total_estimado: number;
  items_count: number;
  estado: EstadoPedidoCaja;
  en_cola_caja: boolean;
  venta_numero: string | null;
  venta_id: string | null;
  armado_por_email: string | null;
  abierto_por_email: string | null;
  created_at: string | null;
  facturado_at: string | null;
};

function fmtGs(n: number) {
  return `Gs. ${Math.round(n || 0).toLocaleString("es-PY")}`;
}
function fmtFecha(iso: string | null) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return (
      d.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "2-digit" }) +
      " · " +
      d.toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" })
    );
  } catch {
    return iso;
  }
}

const ESTADOS: {
  value: "todos" | EstadoPedidoCaja;
  label: string;
  className: string;
}[] = [
  { value: "todos", label: "Todos", className: "bg-slate-100 text-slate-700 border-slate-200" },
  { value: "pendiente", label: "Pendiente", className: "bg-amber-50 text-amber-700 border-amber-200" },
  { value: "en_caja", label: "En caja", className: "bg-sky-50 text-sky-700 border-sky-200" },
  { value: "facturado", label: "Facturado", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  { value: "cancelado", label: "Cancelado", className: "bg-slate-100 text-slate-600 border-slate-200" },
];

export default function PedidosPage() {
  const [items, setItems] = useState<PedidoLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [estado, setEstado] = useState<"todos" | EstadoPedidoCaja>("pendiente");
  const [busqueda, setBusqueda] = useState("");
  const [busquedaDebounced, setBusquedaDebounced] = useState("");
  const [soloMios, setSoloMios] = useState(false);

  // Estado de acciones en progreso por id (para deshabilitar botones).
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setBusquedaDebounced(busqueda), 350);
    return () => clearTimeout(t);
  }, [busqueda]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("estado", estado);
      if (soloMios) params.set("mios", "1");
      if (busquedaDebounced.trim()) params.set("q", busquedaDebounced.trim());
      const r = await fetchWithSupabaseSession(
        `/api/pedidos-caja?${params.toString()}`,
        { cache: "no-store" }
      );
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo cargar");
      const raw = (j.data?.pedidos ?? []) as Array<Record<string, unknown>>;
      setItems(
        raw.map((p) => ({
          id: String(p.id),
          numero: p.numero ? String(p.numero) : null,
          titulo: String(p.titulo ?? ""),
          cliente_nombre: p.cliente_nombre ? String(p.cliente_nombre) : null,
          total_estimado: Number(p.total_estimado) || 0,
          items_count: Array.isArray(p.items) ? (p.items as unknown[]).length : 0,
          estado: ((): EstadoPedidoCaja => {
            const e = p.estado;
            if (e === "facturado" || e === "cancelado" || e === "en_caja") return e;
            return "pendiente";
          })(),
          en_cola_caja: p.en_cola_caja !== false,
          venta_numero: p.venta_numero ? String(p.venta_numero) : null,
          venta_id: p.venta_id ? String(p.venta_id) : null,
          armado_por_email: p.armado_por_email ? String(p.armado_por_email) : null,
          abierto_por_email: p.abierto_por_email ? String(p.abierto_por_email) : null,
          created_at: p.created_at ? String(p.created_at) : null,
          facturado_at: p.facturado_at ? String(p.facturado_at) : null,
        }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }, [estado, soloMios, busquedaDebounced]);

  useEffect(() => {
    load();
  }, [load]);

  // ============================================================
  // Acciones
  // ============================================================

  async function handleLiberar(p: PedidoLite) {
    setBusyId(p.id);
    try {
      const r = await fetchWithSupabaseSession(
        `/api/pedidos-caja/${p.id}/liberar`,
        { method: "POST" }
      );
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "Error");
      await load();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "No se pudo liberar.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleEnviarACaja(p: PedidoLite) {
    setBusyId(p.id);
    try {
      const r = await fetchWithSupabaseSession(
        `/api/pedidos-caja/${p.id}/enviar-a-caja`,
        { method: "POST" }
      );
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "Error");
      await load();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "No se pudo enviar a caja.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleCancelar(p: PedidoLite) {
    const ok = window.confirm(
      `¿Cancelar el pedido ${p.numero ?? ""}?\n\n` +
        `Total: ${fmtGs(p.total_estimado)} · ${p.items_count} item(s).\n\n` +
        `Esta acción no se puede deshacer.`
    );
    if (!ok) return;
    setBusyId(p.id);
    try {
      const r = await fetchWithSupabaseSession(
        `/api/pedidos-caja/${p.id}?motivo=cancelado+por+usuario`,
        { method: "DELETE" }
      );
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "Error");
      await load();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "No se pudo cancelar.");
    } finally {
      setBusyId(null);
    }
  }

  // ============================================================
  // Render
  // ============================================================

  const hayFiltros = useMemo(
    () => soloMios || !!busqueda || estado !== "pendiente",
    [soloMios, busqueda, estado]
  );

  function clearFiltros() {
    setBusqueda("");
    setEstado("pendiente");
    setSoloMios(false);
  }

  const inputClass =
    "h-10 rounded-lg border-2 border-slate-200 bg-white px-3 text-sm outline-none transition-all hover:border-slate-300 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";

  return (
    <div className="w-full py-8 px-4 sm:px-6 lg:px-8 space-y-6">
      {/* Header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-[#4FAEB2]/8 border border-[#4FAEB2]/30 px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#3F8E91] mb-3">
            <Receipt className="h-3 w-3 text-[#4FAEB2]" />
            Operaciones · Salón
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-800 tracking-tight leading-tight">
            Pedidos
          </h1>
          <p className="text-[14px] text-slate-500 mt-1.5">
            Gestión de pedidos del salón. El cobro y la facturación se hacen
            desde la{" "}
            <Link href="/ventas" className="font-semibold text-[#3F8E91] hover:underline">
              Caja
            </Link>{" "}
            (listado «Pedidos por cobrar»).
          </p>
        </div>
        <Link
          href="/pedidos/nuevo"
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] hover:bg-[#3F8E91] text-white text-sm font-bold px-4 py-2.5 transition-colors shadow-sm shadow-[#4FAEB2]/30"
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          Nuevo pedido
        </Link>
      </header>

      {/* Card */}
      <section className="bg-white rounded-2xl border-2 border-[#4FAEB2]/20 shadow-[0_2px_10px_-2px_rgba(79,174,178,0.12)] overflow-hidden">
        {/* Filtros */}
        <div className="px-5 py-4 border-b border-[#4FAEB2]/15 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent">
          {/* Tabs de estado */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            {ESTADOS.map((e) => {
              const sel = estado === e.value;
              return (
                <button
                  key={e.value}
                  type="button"
                  onClick={() => setEstado(e.value)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border-2 px-3 py-1.5 text-xs font-bold transition-all ${
                    sel
                      ? "border-[#4FAEB2] bg-[#4FAEB2] text-white shadow-sm shadow-[#4FAEB2]/30"
                      : `${e.className} hover:border-slate-300`
                  }`}
                >
                  {e.label}
                </button>
              );
            })}
          </div>

          {/* Buscador + toggle */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
            <div className="md:col-span-8 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar por número, cliente o vendedor..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                className={`${inputClass} w-full pl-9 pr-9`}
              />
              {busqueda && (
                <button
                  onClick={() => setBusqueda("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="md:col-span-4 flex items-center justify-end gap-3 flex-wrap">
              <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={soloMios}
                  onChange={(e) => setSoloMios(e.target.checked)}
                  className="rounded"
                />
                Solo mis pedidos
              </label>
              {hayFiltros && (
                <button
                  onClick={clearFiltros}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-[#3F8E91] hover:bg-[#4FAEB2]/8 rounded-lg px-2.5 py-1.5 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                  Limpiar
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Tabla */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="bg-slate-50/70 text-slate-500 text-[11px] uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3 font-semibold">Pedido</th>
                <th className="px-3 py-3 font-semibold">Cliente</th>
                <th className="px-3 py-3 font-semibold">Vendedor</th>
                <th className="px-3 py-3 text-right font-semibold">Items</th>
                <th className="px-3 py-3 text-right font-semibold">Total</th>
                <th className="px-3 py-3 font-semibold">Estado</th>
                <th className="px-3 py-3 font-semibold">Fecha</th>
                <th className="px-3 py-3 text-right font-semibold">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-sm text-slate-400">
                    Cargando...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center">
                    <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-[#4FAEB2]/8 border border-[#4FAEB2]/20 mb-3">
                      <Receipt className="h-6 w-6 text-[#4FAEB2]" />
                    </div>
                    <p className="text-sm font-semibold text-slate-700">
                      {error ?? "No hay pedidos para mostrar"}
                    </p>
                    {!error && estado !== "todos" && (
                      <button
                        onClick={() => setEstado("todos")}
                        className="mt-2 text-xs font-semibold text-[#3F8E91] hover:underline"
                      >
                        Ver todos los estados
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                items.map((p) => (
                  <tr
                    key={p.id}
                    className="hover:bg-[#4FAEB2]/3 transition-colors"
                  >
                    <td className="px-5 py-3 font-bold text-slate-800 font-mono text-xs whitespace-nowrap">
                      <Link
                        href={`/pedidos/${p.id}`}
                        className="hover:text-[#3F8E91] hover:underline"
                        title="Ver detalle del pedido"
                      >
                        {p.numero ?? p.titulo}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      {p.cliente_nombre ?? (
                        <span className="text-slate-300">— Sin cliente</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-slate-500 text-xs">
                      {p.armado_por_email ?? <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-700">
                      {p.items_count}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums font-bold text-slate-900">
                      {fmtGs(p.total_estimado)}
                    </td>
                    <td className="px-3 py-3">
                      <EstadoBadge p={p} />
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-500 tabular-nums whitespace-nowrap">
                      {fmtFecha(p.created_at)}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <Acciones
                          p={p}
                          busy={busyId === p.id}
                          onLiberar={() => handleLiberar(p)}
                          onEnviarACaja={() => handleEnviarACaja(p)}
                          onCancelar={() => handleCancelar(p)}
                        />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        {!loading && items.length > 0 && (
          <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/40 text-xs text-slate-500">
            Mostrando <span className="font-semibold text-slate-700">{items.length}</span>{" "}
            {items.length === 1 ? "pedido" : "pedidos"}
            {estado !== "todos" && (
              <span>
                {" "}
                con estado{" "}
                <span className="font-semibold text-slate-700">
                  {ESTADOS.find((e) => e.value === estado)?.label.toLowerCase()}
                </span>
              </span>
            )}
            .
          </div>
        )}
      </section>
    </div>
  );
}

// ============================================================
// Componentes internos
// ============================================================

function EstadoBadge({ p }: { p: PedidoLite }) {
  if (p.estado === "facturado") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
        <CheckCircle2 className="h-3 w-3" />
        Facturado{p.venta_numero ? ` · ${p.venta_numero}` : ""}
      </span>
    );
  }
  if (p.estado === "cancelado") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
        <XCircle className="h-3 w-3" />
        Cancelado
      </span>
    );
  }
  if (p.estado === "en_caja") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-md bg-sky-50 border border-sky-200 px-2 py-0.5 text-[11px] font-semibold text-sky-700"
        title={p.abierto_por_email ? `Tomado por ${p.abierto_por_email}` : undefined}
      >
        <Lock className="h-3 w-3" />
        En caja
        {p.abierto_por_email && (
          <span className="text-sky-500 font-normal hidden sm:inline">
            · {p.abierto_por_email.split("@")[0]}
          </span>
        )}
      </span>
    );
  }
  // Pendiente pero liberado (fuera de la cola de Caja): volvió al vendedor.
  if (!p.en_cola_caja) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-md bg-slate-100 border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600"
        title="Liberado: volvió al vendedor. No está en la cola de Caja."
      >
        <Unlock className="h-3 w-3" />
        Con vendedor
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
      <Clock className="h-3 w-3" />
      Pendiente
    </span>
  );
}

function Acciones({
  p,
  busy,
  onLiberar,
  onEnviarACaja,
  onCancelar,
}: {
  p: PedidoLite;
  busy: boolean;
  onLiberar: () => void;
  onEnviarACaja: () => void;
  onCancelar: () => void;
}) {
  if (p.estado === "facturado" || p.estado === "cancelado") {
    return (
      <Link
        href={`/pedidos/${p.id}`}
        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:border-[#4FAEB2] hover:text-[#3F8E91]"
        title="Ver detalle del pedido"
      >
        <Eye className="h-3 w-3" />
        Ver
      </Link>
    );
  }

  // pendiente / en_caja
  return (
    <>
      <Link
        href={`/pedidos/${p.id}`}
        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:border-[#4FAEB2] hover:text-[#3F8E91]"
        title="Ver detalle"
      >
        <Eye className="h-3 w-3" />
      </Link>
      {p.estado === "pendiente" && (
        <Link
          href={`/pedidos/${p.id}/editar`}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:border-[#4FAEB2] hover:text-[#3F8E91]"
          title="Editar pedido"
        >
          <Pencil className="h-3 w-3" />
        </Link>
      )}
      {/* En la cola de Caja (o tomado): "Liberar" lo saca y lo devuelve al vendedor. */}
      {((p.estado === "pendiente" && p.en_cola_caja) || p.estado === "en_caja") && (
        <button
          type="button"
          onClick={onLiberar}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:border-amber-400 hover:text-amber-700 disabled:opacity-50"
          title="Liberar: sacar de la cola de Caja y devolver al vendedor"
        >
          <Unlock className="h-3 w-3" />
        </button>
      )}
      {/* Liberado (fuera de la cola): "Enviar a Caja" lo vuelve a poner disponible para cobrar. */}
      {p.estado === "pendiente" && !p.en_cola_caja && (
        <button
          type="button"
          onClick={onEnviarACaja}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] hover:bg-[#3F8E91] text-white text-xs font-bold px-3 py-1.5 transition-colors shadow-sm shadow-[#4FAEB2]/30 disabled:opacity-50"
          title="Enviar el pedido a la cola de Caja para cobrar"
        >
          <Send className="h-3 w-3" />
          Enviar a Caja
        </button>
      )}
      <button
        type="button"
        onClick={onCancelar}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
        title="Cancelar pedido"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </>
  );
}
