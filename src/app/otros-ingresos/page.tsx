"use client";

/**
 * /otros-ingresos — Ingresos manuales que NO son ventas de productos
 * (cartones, servicios, alquileres, ajustes positivos, etc).
 *
 * Suman a caja por el mismo computeResumen que ya existe (van como
 * tipo='ingreso' en caja_movimientos). Inventario NO se toca.
 *
 * Reglas duras enforcd por API:
 *   - Concepto requerido
 *   - Monto > 0
 *   - Medio pago valido
 *   - Caja abierta requerida (al menos una)
 *   - Anulacion soft (preserva auditoria)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  X,
  Search,
  Loader2,
  Wallet,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Calendar,
  Eye,
} from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import MontoInput from "@/components/ui/MontoInput";

type Ingreso = {
  id: string;
  caja_id: string;
  concepto: string;
  monto: number;
  medio_pago: "efectivo" | "tarjeta" | "transferencia" | "otro";
  observacion: string | null;
  usuario_email: string | null;
  created_at: string;
  anulado_at: string | null;
  anulado_motivo: string | null;
  caja_estado: "abierta" | "cerrada" | null;
  caja_fecha_apertura: string | null;
};

function fmtGs(v: number) {
  return `Gs. ${Math.round(v || 0).toLocaleString("es-PY")}`;
}
function fmtFecha(iso: string) {
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

const MEDIOS = [
  { value: "efectivo", label: "Efectivo" },
  { value: "tarjeta", label: "Tarjeta" },
  { value: "transferencia", label: "Transferencia" },
  { value: "otro", label: "Otro" },
] as const;

export default function OtrosIngresosPage() {
  // Datos
  const [items, setItems] = useState<Ingreso[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  // Filtros
  const [estado, setEstado] = useState<"activos" | "anulados" | "todos">("activos");
  const [medio, setMedio] = useState("");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [busquedaDeb, setBusquedaDeb] = useState("");

  // Modal crear + detalle
  const [creando, setCreando] = useState(false);
  const [verDetalle, setVerDetalle] = useState<Ingreso | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setBusquedaDeb(busqueda), 350);
    return () => clearTimeout(t);
  }, [busqueda]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("estado", estado);
      if (medio) params.set("medio_pago", medio);
      if (fechaDesde) params.set("fecha_desde", fechaDesde);
      if (fechaHasta) params.set("fecha_hasta", fechaHasta);
      if (busquedaDeb) params.set("q", busquedaDeb);
      const r = await fetchWithSupabaseSession(
        `/api/otros-ingresos?${params.toString()}`,
        { cache: "no-store" }
      );
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "Error");
      setItems((j.data?.ingresos ?? []) as Ingreso[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }, [estado, medio, fechaDesde, fechaHasta, busquedaDeb]);

  useEffect(() => {
    load();
  }, [load]);

  function notifyOk(msg: string) {
    setOkMsg(msg);
    setTimeout(() => setOkMsg(null), 2800);
  }

  async function anular(ing: Ingreso) {
    const motivo = window.prompt(
      `Anular ingreso "${ing.concepto}" (${fmtGs(ing.monto)}).\nMotivo (opcional):`,
      ""
    );
    if (motivo === null) return; // cancelado
    try {
      const r = await fetchWithSupabaseSession(`/api/otros-ingresos/${ing.id}/anular`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "Error");
      notifyOk("Ingreso anulado.");
      await load();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "No se pudo anular.");
    }
  }

  const totalActivos = useMemo(
    () => items.filter((i) => !i.anulado_at).reduce((s, i) => s + i.monto, 0),
    [items]
  );

  const hayFiltros = !!(estado !== "activos" || medio || fechaDesde || fechaHasta || busqueda);
  function clearFiltros() {
    setEstado("activos");
    setMedio("");
    setFechaDesde("");
    setFechaHasta("");
    setBusqueda("");
  }

  const inputClass =
    "h-10 rounded-lg border-2 border-slate-200 bg-white px-3 text-sm outline-none transition-all hover:border-slate-300 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";

  return (
    <div className="w-full py-8 px-4 sm:px-6 lg:px-8 space-y-6">
      {/* Header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-[#4FAEB2]/8 border border-[#4FAEB2]/30 px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#3F8E91] mb-3">
            <Wallet className="h-3 w-3 text-[#4FAEB2]" />
            Finanzas · Caja
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-800 tracking-tight leading-tight">
            Otros ingresos
          </h1>
          <p className="text-[14px] text-slate-500 mt-1.5">
            Ingresos manuales que no provienen de venta de productos (cartones,
            servicios, alquileres, etc). Suman a caja, no tocan inventario.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreando(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] hover:bg-[#3F8E91] text-white text-sm font-bold px-4 py-2.5 transition-colors shadow-sm shadow-[#4FAEB2]/30"
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          Registrar ingreso
        </button>
      </header>

      {/* Alertas */}
      {error && (
        <div className="flex items-start gap-2 rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)}>
            <X className="h-4 w-4 text-red-500" />
          </button>
        </div>
      )}
      {okMsg && (
        <div className="flex items-center gap-2 rounded-xl border-2 border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          <CheckCircle2 className="h-4 w-4" />
          {okMsg}
        </div>
      )}

      {/* Card principal */}
      <section className="bg-white rounded-2xl border-2 border-[#4FAEB2]/20 shadow-[0_2px_10px_-2px_rgba(79,174,178,0.12)] overflow-hidden">
        {/* Filtros */}
        <div className="px-5 py-4 border-b border-[#4FAEB2]/15 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent">
          {/* Tabs estado */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            {[
              { v: "activos", label: "Activos", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
              { v: "anulados", label: "Anulados", cls: "bg-slate-100 text-slate-600 border-slate-200" },
              { v: "todos", label: "Todos", cls: "bg-slate-100 text-slate-700 border-slate-200" },
            ].map((e) => {
              const sel = estado === e.v;
              return (
                <button
                  key={e.v}
                  type="button"
                  onClick={() => setEstado(e.v as typeof estado)}
                  className={`inline-flex items-center rounded-lg border-2 px-3 py-1.5 text-xs font-bold transition-all ${
                    sel
                      ? "border-[#4FAEB2] bg-[#4FAEB2] text-white shadow-sm shadow-[#4FAEB2]/30"
                      : `${e.cls} hover:border-slate-300`
                  }`}
                >
                  {e.label}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="md:col-span-5 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar por concepto..."
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
            <select
              value={medio}
              onChange={(e) => setMedio(e.target.value)}
              className={`${inputClass} md:col-span-3`}
            >
              <option value="">Todos los métodos</option>
              {MEDIOS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <div className="md:col-span-2 flex items-center gap-1.5">
              <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
              <input
                type="date"
                value={fechaDesde}
                onChange={(e) => setFechaDesde(e.target.value)}
                max={fechaHasta || undefined}
                className={`${inputClass} w-full`}
              />
            </div>
            <div className="md:col-span-2 flex items-center gap-1.5">
              <input
                type="date"
                value={fechaHasta}
                onChange={(e) => setFechaHasta(e.target.value)}
                min={fechaDesde || undefined}
                className={`${inputClass} w-full`}
              />
            </div>
          </div>
          {hayFiltros && (
            <button
              onClick={clearFiltros}
              className="inline-flex items-center gap-1 mt-3 text-xs font-semibold text-slate-500 hover:text-[#3F8E91] hover:bg-[#4FAEB2]/8 rounded-lg px-2.5 py-1.5 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
              Limpiar filtros
            </button>
          )}
        </div>

        {/* Tabla */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="bg-slate-50/70 text-slate-500 text-[11px] uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3 font-semibold">Fecha</th>
                <th className="px-3 py-3 font-semibold">Concepto</th>
                <th className="px-3 py-3 font-semibold">Método</th>
                <th className="px-3 py-3 font-semibold">Usuario</th>
                <th className="px-3 py-3 text-right font-semibold">Monto</th>
                <th className="px-3 py-3 font-semibold">Estado</th>
                <th className="px-3 py-3 text-right font-semibold">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-sm text-slate-400">
                    Cargando...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center">
                    <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-[#4FAEB2]/8 border border-[#4FAEB2]/20 mb-3">
                      <Wallet className="h-6 w-6 text-[#4FAEB2]" />
                    </div>
                    <p className="text-sm font-semibold text-slate-700">
                      No hay ingresos para mostrar
                    </p>
                    <button
                      onClick={() => setCreando(true)}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] hover:bg-[#3F8E91] text-white text-xs font-bold px-3 py-1.5"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Registrar el primero
                    </button>
                  </td>
                </tr>
              ) : (
                items.map((i) => {
                  const isAnulado = !!i.anulado_at;
                  return (
                    <tr
                      key={i.id}
                      className={`hover:bg-[#4FAEB2]/3 transition-colors ${
                        isAnulado ? "opacity-60" : ""
                      }`}
                    >
                      <td className="px-5 py-3 text-xs text-slate-500 tabular-nums whitespace-nowrap">
                        {fmtFecha(i.created_at)}
                      </td>
                      <td className="px-3 py-3">
                        <p
                          className={`font-semibold text-slate-800 ${
                            isAnulado ? "line-through" : ""
                          }`}
                        >
                          {i.concepto}
                        </p>
                        {i.observacion && (
                          <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                            {i.observacion}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <MedioBadge medio={i.medio_pago} />
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-500">
                        {i.usuario_email ?? <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums font-bold text-[#3F8E91]">
                        {fmtGs(i.monto)}
                      </td>
                      <td className="px-3 py-3">
                        {isAnulado ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-md bg-slate-100 border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600"
                            title={i.anulado_motivo ?? undefined}
                          >
                            <XCircle className="h-3 w-3" />
                            Anulado
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                            <CheckCircle2 className="h-3 w-3" />
                            Activo
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setVerDetalle(i)}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:border-[#4FAEB2] hover:text-[#3F8E91]"
                            title="Ver detalle"
                          >
                            <Eye className="h-3 w-3" />
                          </button>
                          {!isAnulado && (
                            <button
                              onClick={() => anular(i)}
                              className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                              title="Anular"
                            >
                              <XCircle className="h-3 w-3" />
                              Anular
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {items.length > 0 && (
              <tfoot className="bg-slate-50/40 border-t-2 border-slate-100">
                <tr>
                  <td colSpan={4} className="px-5 py-3 text-right font-bold text-slate-700">
                    Total activos del filtro
                  </td>
                  <td className="px-3 py-3 text-right font-bold tabular-nums text-lg text-[#3F8E91]">
                    {fmtGs(totalActivos)}
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      {/* Modal crear */}
      {creando && (
        <CrearIngresoModal
          onClose={() => setCreando(false)}
          onCreated={async () => {
            setCreando(false);
            notifyOk("Ingreso registrado correctamente.");
            await load();
          }}
        />
      )}

      {/* Modal detalle */}
      {verDetalle && <DetalleModal ing={verDetalle} onClose={() => setVerDetalle(null)} />}
    </div>
  );
}

// ============================================================
// Subcomponentes
// ============================================================

function MedioBadge({ medio }: { medio: Ingreso["medio_pago"] }) {
  const cls =
    medio === "efectivo"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : medio === "tarjeta"
      ? "bg-violet-50 text-violet-700 border-violet-200"
      : medio === "transferencia"
      ? "bg-sky-50 text-sky-700 border-sky-200"
      : "bg-slate-100 text-slate-600 border-slate-200";
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold capitalize ${cls}`}>
      {medio}
    </span>
  );
}

function CrearIngresoModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [concepto, setConcepto] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [monto, setMonto] = useState("");
  const [medio, setMedio] = useState<"efectivo" | "tarjeta" | "transferencia" | "otro">("efectivo");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const m = Number(monto);
    if (!concepto.trim()) {
      setError("Concepto requerido.");
      return;
    }
    if (!Number.isFinite(m) || m <= 0) {
      setError("El monto debe ser mayor a 0.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession("/api/otros-ingresos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          concepto: concepto.trim(),
          descripcion: descripcion.trim() || null,
          monto: m,
          medio_pago: medio,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
      await onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error.");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md border-2 border-[#4FAEB2]/20 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent flex items-start justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-800">Registrar otro ingreso</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Suma a caja. No toca inventario.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="h-8 w-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
              Concepto *
            </label>
            <input
              type="text"
              value={concepto}
              onChange={(e) => setConcepto(e.target.value)}
              placeholder="Ej: Venta de cartones, Alquiler, Servicios"
              maxLength={200}
              autoFocus
              className="w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
                Monto (Gs.) *
              </label>
              <MontoInput
                value={monto}
                onChange={(n) => setMonto(String(n))}
                decimals={false}
                className="w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm font-semibold tabular-nums focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
                Método de pago *
              </label>
              <select
                value={medio}
                onChange={(e) => setMedio(e.target.value as typeof medio)}
                className="w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm bg-white focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 outline-none"
              >
                <option value="efectivo">Efectivo</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="transferencia">Transferencia</option>
                <option value="otro">Otro</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
              Descripción (opcional)
            </label>
            <textarea
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Detalle adicional..."
              className="w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 outline-none resize-none"
            />
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2.5 text-xs text-amber-800">
            ⚠ Requiere caja abierta. Si no hay caja, primero abrila desde
            <span className="font-semibold"> Caja → Abrir caja</span>.
          </div>

          {error && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="text-sm font-semibold text-slate-600 hover:text-slate-900 px-4 py-2 rounded-lg disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-[#4FAEB2] hover:bg-[#3F8E91] disabled:opacity-50 text-white text-sm font-bold px-5 py-2 transition-colors"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Registrar
          </button>
        </div>
      </div>
    </div>
  );
}

function DetalleModal({ ing, onClose }: { ing: Ingreso; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md border-2 border-[#4FAEB2]/20"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent flex items-start justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-800">Detalle del ingreso</h3>
            <p className="text-xs text-slate-500 mt-0.5 tabular-nums">{fmtFecha(ing.created_at)}</p>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4 mx-auto" />
          </button>
        </div>
        <div className="p-5 space-y-3 text-sm">
          <Field label="Concepto" value={ing.concepto} bold />
          <Field label="Monto" value={fmtGs(ing.monto)} bold highlight />
          <Field label="Método de pago" value={ing.medio_pago} capitalize />
          {ing.observacion && <Field label="Descripción" value={ing.observacion} />}
          <Field label="Usuario" value={ing.usuario_email ?? "—"} />
          {ing.anulado_at && (
            <>
              <Field label="Anulado" value={fmtFecha(ing.anulado_at)} highlightRed />
              {ing.anulado_motivo && <Field label="Motivo" value={ing.anulado_motivo} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  bold,
  highlight,
  highlightRed,
  capitalize,
}: {
  label: string;
  value: string;
  bold?: boolean;
  highlight?: boolean;
  highlightRed?: boolean;
  capitalize?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500 shrink-0">
        {label}
      </span>
      <span
        className={`text-right ${bold ? "font-bold" : ""} ${capitalize ? "capitalize" : ""} ${
          highlight ? "text-[#3F8E91] text-base" : highlightRed ? "text-red-600" : "text-slate-700"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
