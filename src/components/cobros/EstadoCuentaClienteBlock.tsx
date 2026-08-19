"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Download, ChevronDown, ChevronUp } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { RegistrarCobroModalCxc, type CxcRef } from "@/components/cobros/RegistrarCobroModalCxc";

type Mov = {
  id: string;
  numero_venta: string | null;
  fecha_emision: string | null;
  fecha_vencimiento: string | null;
  total: number;
  cobrado: number;
  saldo: number;
  estado: string;
  vencida: boolean;
};
type Resumen = { total_vendido: number; saldo_pendiente: number; total_cobrado: number; vencido: number };

const ESTADO_BADGE: Record<string, string> = {
  pendiente: "bg-amber-100 text-amber-700",
  parcial: "bg-sky-100 text-sky-700",
  pagado: "bg-emerald-100 text-emerald-700",
  vencido: "bg-red-100 text-red-700",
  anulado: "bg-slate-100 text-slate-500",
};

function fmtGs(n: number) {
  return "Gs. " + Math.round(Number(n) || 0).toLocaleString("es-PY");
}
function fmtFecha(iso: string | null) {
  if (!iso) return "—";
  const s = String(iso).slice(0, 10);
  const [y, m, d] = s.split("-");
  return d && m && y ? `${d}/${m}/${y}` : s;
}
function diasMora(venc: string | null, vencida: boolean): number {
  if (!vencida || !venc) return 0;
  const hoy = new Date(new Date().toISOString().slice(0, 10));
  const v = new Date(String(venc).slice(0, 10));
  const diff = Math.floor((hoy.getTime() - v.getTime()) / 86400000);
  return diff > 0 ? diff : 0;
}

/**
 * Bloque de Estado de cuenta del cliente basado en cuentas_por_cobrar/cobros_clientes.
 * Muestra todas las cuentas tal cual (sin filtros), con cards de resumen y registro de cobro.
 */
export function EstadoCuentaClienteBlock({
  clienteId,
  onCambio,
}: {
  clienteId: string;
  onCambio?: () => void;
}) {
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [movs, setMovs] = useState<Mov[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(true);
  const [cobrando, setCobrando] = useState<CxcRef | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!clienteId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithSupabaseSession(`/api/clientes/${clienteId}/estado-cuenta`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok || body?.success === false) {
        setError(body?.error ?? "No se pudo cargar el estado de cuenta.");
        return;
      }
      setResumen(body.data.resumen);
      setMovs((body.data.movimientos ?? []) as Mov[]);
    } catch {
      setError("Error de red.");
    } finally {
      setLoading(false);
    }
  }, [clienteId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Resumen por cantidades (cada cuenta cae en exactamente un grupo).
  const m = useMemo(() => {
    const activas = movs.filter((x) => x.estado !== "anulado");
    const montoTotal = activas.reduce((a, x) => a + x.total, 0);
    const saldoPend = activas.reduce((a, x) => a + x.saldo, 0);
    const esPend = (x: Mov) => (x.estado === "pendiente" || x.estado === "parcial");
    const vencidas = activas.filter((x) => esPend(x) && x.vencida);
    const pendientes = activas.filter((x) => esPend(x) && !x.vencida);
    const pagadas = activas.filter((x) => x.estado === "pagado");
    return {
      cuentas: activas.length,
      montoTotal,
      saldoPend,
      vencidas: vencidas.length,
      pendientes: pendientes.length,
      pagadas: pagadas.length,
    };
  }, [movs]);

  const sinCuentas = !loading && movs.length === 0;

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {toast && (
        <div className="fixed top-4 right-4 z-50 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg">✓ {toast}</div>
      )}

      {/* Cabecera tipo "FACTURAS del cliente" */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/60 bg-slate-50/90 px-3 py-2.5 sm:px-4">
        <button type="button" onClick={() => setAbierto((v) => !v)} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5 text-left">
          <span className="inline-flex shrink-0 text-slate-500" aria-hidden>
            {abierto ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">Estado de cuenta</span>
          <span className="hidden text-[10px] font-normal text-slate-400 sm:inline">del cliente</span>
          <span className="hidden h-3 w-px bg-slate-200 sm:inline" />
          <span className="rounded-md bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-700 ring-1 ring-slate-200/80">{m.cuentas} cuenta{m.cuentas === 1 ? "" : "s"}</span>
          <span className="rounded-md bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-700 ring-1 ring-slate-200/80">Saldo {fmtGs(m.saldoPend)}</span>
          {m.vencidas > 0 ? (
            <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700 ring-1 ring-red-200/80">{m.vencidas} venc.</span>
          ) : null}
        </button>
        <a
          href={`/api/clientes/${clienteId}/estado-cuenta/pdf?auto=1`}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <Download className="h-3.5 w-3.5" /> Descargar
        </a>
      </div>

      {!abierto ? null : (
        <>
          {/* Cards de resumen */}
          <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 sm:p-4 lg:grid-cols-6">
            <Card label="Cuentas" value={String(m.cuentas)} />
            <Card label="Monto total" value={fmtGs(m.montoTotal)} />
            <Card label="Saldo pend." value={fmtGs(m.saldoPend)} valueClass={m.saldoPend > 0 ? "text-amber-600" : "text-emerald-600"} ring="ring-[#4FAEB2]/20" />
            <Card label="Vencidas" value={String(m.vencidas)} valueClass={m.vencidas > 0 ? "text-red-600" : "text-slate-800"} ring="ring-red-200/70" />
            <Card label="Pendientes" value={String(m.pendientes)} valueClass="text-amber-600" ring="ring-amber-200/70" />
            <Card label="Pagadas" value={String(m.pagadas)} valueClass="text-emerald-700" ring="ring-emerald-200/70" />
          </div>

          {error && <div className="mx-3 mb-3 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700 sm:mx-4">{error}</div>}

          {loading ? (
            <div className="p-8 flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>
          ) : sinCuentas ? (
            <div className="p-8 text-center text-sm text-gray-500">El cliente no tiene cuentas pendientes.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="py-2.5 px-3 font-medium sm:px-4">Tipo</th>
                    <th className="py-2.5 px-3 font-medium">Venta</th>
                    <th className="py-2.5 px-3 font-medium">F. emisión</th>
                    <th className="py-2.5 px-3 font-medium">F. vencimiento</th>
                    <th className="py-2.5 px-3 font-medium text-right">Monto</th>
                    <th className="py-2.5 px-3 font-medium text-right">Cobrado</th>
                    <th className="py-2.5 px-3 font-medium text-right">Saldo</th>
                    <th className="py-2.5 px-3 font-medium text-center">Días mora</th>
                    <th className="py-2.5 px-3 font-medium">Estado</th>
                    <th className="py-2.5 px-3 font-medium text-right">Operación</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {movs.map((x) => {
                    const mora = diasMora(x.fecha_vencimiento, x.vencida);
                    const estadoVis = x.vencida && x.estado !== "pagado" && x.estado !== "anulado" ? "vencido" : x.estado;
                    return (
                      <tr key={x.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 sm:px-4">
                          <span className="inline-flex items-center gap-1.5 text-xs text-slate-600"><span className="h-1.5 w-1.5 rounded-full bg-[#4FAEB2]" /> Crédito</span>
                        </td>
                        <td className="py-2.5 px-3 font-mono font-medium text-gray-800">{x.numero_venta ?? "—"}</td>
                        <td className="py-2.5 px-3 text-gray-600">{fmtFecha(x.fecha_emision)}</td>
                        <td className={`py-2.5 px-3 ${x.vencida ? "font-semibold text-red-600" : "text-gray-600"}`}>{fmtFecha(x.fecha_vencimiento)}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums">{fmtGs(x.total)}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-emerald-700">{fmtGs(x.cobrado)}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-semibold text-amber-600">{fmtGs(x.saldo)}</td>
                        <td className={`py-2.5 px-3 text-center tabular-nums ${mora > 0 ? "font-semibold text-red-600" : "text-slate-400"}`}>{mora > 0 ? mora : "—"}</td>
                        <td className="py-2.5 px-3">
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ESTADO_BADGE[estadoVis] ?? ESTADO_BADGE.pendiente}`}>
                            {estadoVis.charAt(0).toUpperCase() + estadoVis.slice(1)}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {x.estado === "pagado" || x.estado === "anulado" ? (
                            <span className="text-xs text-gray-400">—</span>
                          ) : (
                            <button
                              onClick={() => setCobrando({ id: x.id, numero_venta: x.numero_venta, saldo: x.saldo })}
                              className="rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91]"
                            >
                              Cobrar
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50/90">
                    <td colSpan={4} className="px-3 py-2.5 text-xs text-slate-500 sm:px-4">
                      <span className="font-semibold text-slate-700">{m.cuentas}</span> cuenta{m.cuentas === 1 ? "" : "s"}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Total</span>
                      <p className="text-sm font-bold tabular-nums text-slate-800">{fmtGs(m.montoTotal)}</p>
                    </td>
                    <td className="px-3 py-2.5" />
                    <td className="px-3 py-2.5 text-right">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Saldo</span>
                      <p className={`text-sm font-bold tabular-nums ${m.saldoPend > 0 ? "text-amber-600" : "text-emerald-700"}`}>{fmtGs(m.saldoPend)}</p>
                    </td>
                    <td colSpan={3} className="px-3 py-2.5" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}

      <RegistrarCobroModalCxc
        open={!!cobrando}
        cuenta={cobrando}
        onClose={() => setCobrando(null)}
        onExito={async () => {
          setToast("Pago registrado");
          setTimeout(() => setToast(null), 2800);
          await cargar();
          onCambio?.();
        }}
      />
    </section>
  );
}

function Card({ label, value, valueClass = "text-slate-800", ring = "ring-slate-200/70" }: { label: string; value: string; valueClass?: string; ring?: string }) {
  return (
    <div className={`rounded-lg border border-slate-200 bg-white px-3 py-2.5 ring-1 ${ring}`}>
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-0.5 text-sm font-bold tabular-nums ${valueClass}`}>{value}</div>
    </div>
  );
}
