"use client";

/**
 * Panel de Caja para /ventas: soporta MÚLTIPLES cajas activas (Caja 1, Caja 2, …).
 * Muestra el estado de cada caja (abierta / en cierre), totales en vivo y modales
 * para abrir, registrar movimiento, pasar a cierre y cerrar (arqueo) por caja.
 *
 * Paleta turquesa del sistema #4FAEB2.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Lock,
  Unlock,
  Plus,
  Minus,
  ArrowUpRight,
  ArrowDownRight,
  Wallet,
  Loader2,
  X,
  CheckCircle2,
  AlertTriangle,
  Clock,
} from "lucide-react";
import MontoInput from "@/components/ui/MontoInput";
import ArqueoDenominaciones, {
  arqueoVacio,
  cantidadesAArqueo,
  totalArqueo,
  type ArqueoCantidades,
} from "@/components/caja/ArqueoDenominaciones";
import type {
  ArqueoItem,
  CajaResumen,
  MedioPagoCaja,
  TipoMovimientoCaja,
} from "@/lib/caja/types";

function fmtGs(v: number) {
  return `Gs. ${Math.round(v || 0).toLocaleString("es-PY")}`;
}
function fmtFechaHora(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-PY", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

type ModalKind = null | "abrir" | "cerrar" | "mov" | "en_cierre";

interface Props {
  onStateChange?: () => void;
}

export default function CajaControlPanel({ onStateChange }: Props) {
  const [cajas, setCajas] = useState<CajaResumen[]>([]);
  const [target, setTarget] = useState<CajaResumen | null>(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalKind>(null);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/caja/estado", {
        credentials: "include",
        cache: "no-store",
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo cargar");
      setCajas((j.data?.cajas ?? []) as CajaResumen[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function notifyOk(msg: string) {
    setOkMsg(msg);
    setTimeout(() => setOkMsg(null), 3000);
  }

  const numerosOcupados = cajas.map((c) => c.caja.numero_caja);
  let numeroSugerido = 1;
  while (numerosOcupados.includes(numeroSugerido)) numeroSugerido++;

  async function handleAbrir(
    monto: number,
    observacion: string | null,
    numeroCaja: number,
    arqueo: ArqueoItem[] | null
  ) {
    const r = await fetch("/api/caja/abrir", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        monto_apertura: monto,
        observacion,
        numero_caja: numeroCaja,
        arqueo_apertura: arqueo,
      }),
    });
    const j = await r.json();
    if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
    setModal(null);
    await load();
    notifyOk(`Caja ${numeroCaja} abierta correctamente.`);
    onStateChange?.();
  }
  async function handleCerrar(monto: number, observacion: string | null, arqueo: ArqueoItem[] | null) {
    if (!target) return;
    const r = await fetch("/api/caja/cerrar", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caja_id: target.caja.id,
        monto_cierre_contado: monto,
        observacion,
        arqueo_cierre: arqueo,
      }),
    });
    const j = await r.json();
    if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
    setModal(null);
    setTarget(null);
    await load();
    notifyOk(`Caja ${target.caja.numero_caja} cerrada correctamente.`);
    onStateChange?.();
  }
  async function handleMov(opts: {
    tipo: TipoMovimientoCaja;
    concepto: string;
    monto: number;
    medio_pago: MedioPagoCaja;
    observacion: string | null;
  }) {
    if (!target) return;
    const r = await fetch("/api/caja/movimiento", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caja_id: target.caja.id, ...opts }),
    });
    const j = await r.json();
    if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
    setModal(null);
    setTarget(null);
    await load();
    notifyOk("Movimiento registrado.");
  }
  async function handleEnCierre() {
    if (!target) return;
    const cr = target;
    const r = await fetch("/api/caja/en-cierre", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caja_id: cr.caja.id }),
    });
    const j = await r.json();
    if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
    setModal(null);
    setTarget(null);
    await load();
    notifyOk(`Caja ${cr.caja.numero_caja} en cierre/conteo.`);
    onStateChange?.();
  }

  if (loading && cajas.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-[#4FAEB2]/20 bg-white p-4 flex items-center gap-3">
        <Loader2 className="h-4 w-4 animate-spin text-[#4FAEB2]" />
        <span className="text-sm text-slate-500">Cargando estado de caja...</span>
      </div>
    );
  }

  // === Sin cajas activas ===
  if (cajas.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-amber-200 bg-amber-50/60 shadow-sm p-5 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-amber-500 flex items-center justify-center shadow-sm shadow-amber-300/40">
            <Lock className="h-4.5 w-4.5 text-white" />
          </div>
          <div>
            <h2 className="text-[15px] font-bold text-amber-900 leading-none">
              Caja cerrada
            </h2>
            <p className="text-xs text-amber-700 mt-1">
              Abrila antes de operar para que las ventas se registren en el turno.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setModal("abrir")}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] hover:bg-[#3F8E91] text-white text-sm font-bold px-4 py-2.5 transition-colors shadow-sm shadow-[#4FAEB2]/30"
        >
          <Unlock className="h-4 w-4" />
          Abrir caja
        </button>

        {modal === "abrir" && (
          <ModalAbrir
            onClose={() => setModal(null)}
            onConfirm={handleAbrir}
            error={error}
            numeroSugerido={numeroSugerido}
            numerosOcupados={numerosOcupados}
          />
        )}

        {okMsg && <ToastOk msg={okMsg} />}
      </div>
    );
  }

  // === Cajas activas (una o varias) ===
  return (
    <div className="space-y-3">
      {/* Barra superior: título + abrir otra caja */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="flex items-center gap-2 text-[15px] font-bold text-slate-800">
          <Wallet className="h-4 w-4 text-[#4FAEB2]" />
          Cajas ({cajas.length})
        </h2>
        <button
          type="button"
          onClick={() => setModal("abrir")}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] hover:bg-[#3F8E91] text-white text-xs font-bold px-3 py-2 transition-colors shadow-sm shadow-[#4FAEB2]/30"
        >
          <Unlock className="h-3.5 w-3.5" />
          Abrir otra caja
        </button>
      </div>

      {cajas.map((cr) => {
        const c = cr.caja;
        const enCierre = c.estado === "en_cierre";
        return (
          <div key={c.id} className="rounded-2xl border-2 border-[#4FAEB2]/25 bg-white shadow-[0_2px_10px_-2px_rgba(79,174,178,0.12)] overflow-hidden">
            {/* Header por caja */}
            <div className="px-5 py-4 border-b border-[#4FAEB2]/15 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <div className={`h-10 w-10 rounded-xl flex items-center justify-center shadow-sm ${enCierre ? "bg-amber-500 shadow-amber-500/30" : "bg-[#4FAEB2] shadow-[#4FAEB2]/30"}`}>
                  <Wallet className="h-4.5 w-4.5 text-white" />
                </div>
                <div>
                  <h3 className="text-[15px] font-bold text-slate-800 leading-none flex items-center gap-2">
                    Caja {c.numero_caja}
                    {enCierre ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 border border-amber-200 px-2 py-0.5 text-[10.5px] font-bold text-amber-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        En cierre
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 border border-emerald-200 px-2 py-0.5 text-[10.5px] font-bold text-emerald-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Abierta
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Abierta el {fmtFechaHora(c.fecha_apertura)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!enCierre && (
                  <>
                    <button
                      type="button"
                      onClick={() => { setTarget(cr); setModal("mov"); }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold px-3 py-2 hover:border-[#4FAEB2] hover:text-[#3F8E91] hover:bg-[#4FAEB2]/5 transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Movimiento
                    </button>
                    <button
                      type="button"
                      onClick={() => { setTarget(cr); setModal("en_cierre"); }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 text-xs font-semibold px-3 py-2 hover:bg-amber-100 transition-colors"
                    >
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Pasar a cierre
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => { setTarget(cr); setModal("cerrar"); }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-3 py-2 transition-colors shadow-sm"
                >
                  <Lock className="h-3.5 w-3.5" />
                  Cerrar
                </button>
              </div>
            </div>

            {enCierre && (
              <div className="px-5 py-2 bg-amber-50/60 border-b border-amber-100 text-[11px] font-medium text-amber-800">
                En conteo — no recibe nuevas ventas ni movimientos. Cargá el efectivo contado para cerrar.
              </div>
            )}

            {/* Metricas en vivo por caja */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-px bg-slate-100">
              <Metric label="Apertura" value={fmtGs(c.monto_apertura)} icon={<Wallet className="h-3.5 w-3.5" />} />
              <Metric label="Ventas" value={String(cr.cantidad_ventas)} icon={<CheckCircle2 className="h-3.5 w-3.5" />} />
              <Metric label="Efectivo" value={fmtGs(cr.total_efectivo)} icon={<ArrowDownRight className="h-3.5 w-3.5 text-emerald-600" />} highlight="emerald" />
              <Metric label="Transfer" value={fmtGs(cr.total_transferencia)} icon={<ArrowDownRight className="h-3.5 w-3.5 text-sky-600" />} />
              <Metric label="Tarjeta" value={fmtGs(cr.total_tarjeta)} icon={<ArrowDownRight className="h-3.5 w-3.5 text-violet-600" />} />
              <Metric label="Esperado efectivo" value={fmtGs(cr.efectivo_esperado)} icon={<Wallet className="h-3.5 w-3.5 text-[#4FAEB2]" />} highlight="turquesa" />
            </div>

            {cr.movimientos.length > 0 && (
              <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/40">
                <p className="text-[10.5px] uppercase tracking-wider font-bold text-slate-500 mb-2">Movimientos manuales</p>
                <ul className="space-y-1">
                  {cr.movimientos.slice(-5).reverse().map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <MovIcon tipo={m.tipo} />
                        <span className="truncate font-medium text-slate-700">{m.concepto}</span>
                        <span className="text-slate-400">·</span>
                        <span className="text-slate-500 capitalize">{m.medio_pago}</span>
                      </span>
                      <span className={`tabular-nums font-bold ${m.tipo === "ingreso" ? "text-emerald-700" : m.tipo === "egreso" || m.tipo === "retiro" ? "text-red-600" : "text-amber-700"}`}>
                        {m.tipo === "egreso" || m.tipo === "retiro" ? "−" : "+"}
                        {fmtGs(Math.abs(m.monto))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}

      {modal === "abrir" && (
        <ModalAbrir
          onClose={() => setModal(null)}
          onConfirm={handleAbrir}
          error={error}
          numeroSugerido={numeroSugerido}
          numerosOcupados={numerosOcupados}
        />
      )}
      {modal === "cerrar" && target && (
        <ModalCerrar
          resumen={target}
          onClose={() => { setModal(null); setTarget(null); }}
          onConfirm={handleCerrar}
        />
      )}
      {modal === "mov" && target && (
        <ModalMovimiento onClose={() => { setModal(null); setTarget(null); }} onConfirm={handleMov} />
      )}
      {modal === "en_cierre" && target && (
        <ModalConfirmar
          title={`Pasar Caja ${target.caja.numero_caja} a cierre`}
          subtitle="Conteo / arqueo del turno"
          mensaje={`La Caja ${target.caja.numero_caja} dejará de recibir ventas y movimientos. Después vas a cargar el efectivo contado para cerrarla. ¿Continuar?`}
          confirmLabel="Pasar a cierre"
          onClose={() => { setModal(null); setTarget(null); }}
          onConfirm={handleEnCierre}
        />
      )}
      {okMsg && <ToastOk msg={okMsg} />}
    </div>
  );
}

// ============================================================
// Subcomponentes
// ============================================================

function Metric({
  label,
  value,
  icon,
  highlight,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  highlight?: "turquesa" | "emerald";
}) {
  const bg =
    highlight === "turquesa"
      ? "bg-[#4FAEB2]/5"
      : highlight === "emerald"
      ? "bg-emerald-50/50"
      : "bg-white";
  return (
    <div className={`${bg} px-3 py-3`}>
      <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 flex items-center gap-1">
        {icon}
        {label}
      </p>
      <p className="text-[15px] font-bold text-slate-800 tabular-nums mt-1">{value}</p>
    </div>
  );
}

function MovIcon({ tipo }: { tipo: TipoMovimientoCaja }) {
  const cls = "h-3 w-3";
  if (tipo === "ingreso") return <Plus className={`${cls} text-emerald-600`} />;
  if (tipo === "egreso") return <Minus className={`${cls} text-red-600`} />;
  if (tipo === "retiro") return <ArrowUpRight className={`${cls} text-red-600`} />;
  return <Wallet className={`${cls} text-amber-600`} />;
}

function ToastOk({ msg }: { msg: string }) {
  return (
    <div className="fixed bottom-4 right-4 z-[100] rounded-xl border-2 border-emerald-200 bg-emerald-50 shadow-lg px-4 py-3 flex items-center gap-2 text-sm text-emerald-800 font-semibold">
      <CheckCircle2 className="h-4 w-4" />
      {msg}
    </div>
  );
}

// ============================================================
// Modales
// ============================================================

function ModalBase({
  title,
  subtitle,
  onClose,
  children,
  maxWidthClass = "max-w-md",
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Ancho máximo del modal (default max-w-md). El arqueo usa uno más ancho. */
  maxWidthClass?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className={`bg-white rounded-2xl shadow-2xl w-full ${maxWidthClass} border-2 border-[#4FAEB2]/20 overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent flex items-start justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-800">{title}</h3>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Modal de confirmación genérico (reemplaza al confirm() nativo). */
function ModalConfirmar({
  title,
  subtitle,
  mensaje,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  title: string;
  subtitle?: string;
  mensaje: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await onConfirm();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
      setBusy(false);
    }
  }
  return (
    <ModalBase title={title} subtitle={subtitle} onClose={busy ? () => {} : onClose}>
      <div className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 shrink-0 rounded-xl bg-[#E5F4F4] border border-[#4FAEB2]/25 flex items-center justify-center">
            <AlertTriangle className="h-4.5 w-4.5 text-[#3F8E91]" />
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">{mensaje}</p>
        </div>
        {err && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {err}
          </p>
        )}
      </div>
      <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="text-sm font-semibold text-slate-600 hover:text-slate-900 px-4 py-2 rounded-lg disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-[#4FAEB2] hover:bg-[#3F8E91] disabled:opacity-50 text-white text-sm font-bold px-5 py-2 transition-colors"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {confirmLabel}
        </button>
      </div>
    </ModalBase>
  );
}

function ModalAbrir({
  onClose,
  onConfirm,
  error,
  numeroSugerido,
  numerosOcupados,
}: {
  onClose: () => void;
  onConfirm: (monto: number, obs: string | null, numeroCaja: number, arqueo: ArqueoItem[] | null) => Promise<void>;
  error: string | null;
  numeroSugerido: number;
  numerosOcupados: number[];
}) {
  const [modo, setModo] = useState<"arqueo" | "monto">("monto");
  const [monto, setMonto] = useState("0");
  const [cant, setCant] = useState<ArqueoCantidades>(arqueoVacio());
  const [obs, setObs] = useState("");
  const [numero, setNumero] = useState(numeroSugerido);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(error);
  const totalArq = totalArqueo(cant);
  async function submit() {
    if (numerosOcupados.includes(numero)) {
      setErr(`La Caja ${numero} ya está activa. Elegí otro número.`);
      return;
    }
    let montoFinal: number;
    let arqueo: ArqueoItem[] | null = null;
    if (modo === "arqueo") {
      arqueo = cantidadesAArqueo(cant);
      montoFinal = totalArq;
    } else {
      const n = Number(monto);
      if (!Number.isFinite(n) || n < 0) {
        setErr("Ingresá un monto válido.");
        return;
      }
      montoFinal = n;
    }
    setBusy(true);
    setErr(null);
    try {
      await onConfirm(montoFinal, obs.trim() || null, numero, arqueo);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
      setBusy(false);
    }
  }
  // Opciones de caja: Caja 1 y Caja 2, deshabilitando las ya activas.
  const opciones = [1, 2];
  return (
    <ModalBase
      title="Abrir caja"
      subtitle="Elegí el número de caja y cargá el efectivo inicial del turno."
      onClose={busy ? () => {} : onClose}
      maxWidthClass={modo === "arqueo" ? "max-w-2xl" : "max-w-md"}
    >
      <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
            Número de caja
          </label>
          <div className="flex flex-wrap gap-2">
            {opciones.map((n) => {
              const ocupada = numerosOcupados.includes(n);
              const sel = numero === n;
              return (
                <button
                  key={n}
                  type="button"
                  disabled={ocupada}
                  onClick={() => setNumero(n)}
                  className={`rounded-lg border-2 px-3 py-1.5 text-sm font-bold transition-colors ${
                    ocupada ? "border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed"
                    : sel ? "border-[#4FAEB2] bg-[#4FAEB2] text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  Caja {n}
                </button>
              );
            })}
          </div>
        </div>

        {/* Toggle Contar/Monto oculto para Ferrecolor: solo monto directo. */}
        {false && <ModoArqueoToggle modo={modo} onChange={setModo} />}

        {modo === "arqueo" ? (
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
              Conteo de efectivo inicial
            </label>
            <ArqueoDenominaciones value={cant} onChange={setCant} disabled={busy} />
            <p className="mt-1.5 text-[11px] text-slate-400">
              El saldo inicial se calcula automáticamente desde el conteo: {fmtGs(totalArq)}.
            </p>
          </div>
        ) : (
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
              Monto inicial (Gs.)
            </label>
            <MontoInput
              value={monto}
              onChange={(n) => setMonto(String(n))}
              decimals={false}
              autoFocus
              className="w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm font-semibold tabular-nums focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 outline-none"
            />
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
            Observación (opcional)
          </label>
          <textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            rows={2}
            className="w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 outline-none resize-none"
          />
        </div>
        {err && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {err}
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
          Abrir caja
        </button>
      </div>
    </ModalBase>
  );
}

/** Toggle entre "Contar por denominaciones" (arqueo) y "Monto directo". */
function ModoArqueoToggle({
  modo,
  onChange,
}: {
  modo: "arqueo" | "monto";
  onChange: (m: "arqueo" | "monto") => void;
}) {
  return (
    <div className="flex rounded-lg border-2 border-slate-200 overflow-hidden text-xs font-bold">
      <button
        type="button"
        onClick={() => onChange("arqueo")}
        className={`flex-1 py-2 transition-colors ${modo === "arqueo" ? "bg-[#4FAEB2] text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
      >
        Contar por denominaciones
      </button>
      <button
        type="button"
        onClick={() => onChange("monto")}
        className={`flex-1 py-2 transition-colors border-l-2 border-slate-200 ${modo === "monto" ? "bg-[#4FAEB2] text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
      >
        Monto directo
      </button>
    </div>
  );
}

function ModalCerrar({
  resumen,
  onClose,
  onConfirm,
}: {
  resumen: CajaResumen;
  onClose: () => void;
  onConfirm: (monto: number, obs: string | null, arqueo: ArqueoItem[] | null) => Promise<void>;
}) {
  const [modo, setModo] = useState<"arqueo" | "monto">("monto");
  const [monto, setMonto] = useState(String(Math.round(resumen.efectivo_esperado)));
  const [cant, setCant] = useState<ArqueoCantidades>(arqueoVacio());
  const [obs, setObs] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const esperado = Math.round(resumen.efectivo_esperado);
  const contado = modo === "arqueo" ? totalArqueo(cant) : Number(monto) || 0;
  const diferencia = contado - esperado;

  async function submit() {
    let arqueo: ArqueoItem[] | null = null;
    if (modo === "arqueo") {
      arqueo = cantidadesAArqueo(cant);
    } else if (!Number.isFinite(contado) || contado < 0) {
      setErr("Ingresá un monto válido.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onConfirm(contado, obs.trim() || null, arqueo);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
      setBusy(false);
    }
  }

  return (
    <ModalBase
      title="Cerrar caja"
      subtitle="Contá el efectivo en mano. El sistema calcula la diferencia."
      onClose={busy ? () => {} : onClose}
      maxWidthClass={modo === "arqueo" ? "max-w-2xl" : "max-w-md"}
    >
      <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
        {/* Resumen del arqueo */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
          <Row label="Apertura" value={fmtGs(resumen.caja.monto_apertura)} />
          <Row label={`Ventas efectivo (${resumen.cantidad_ventas})`} value={fmtGs(resumen.total_efectivo)} />
          {resumen.total_tarjeta > 0 && (
            <Row label="Ventas tarjeta (no suma)" value={fmtGs(resumen.total_tarjeta)} subtle />
          )}
          {resumen.total_transferencia > 0 && (
            <Row label="Ventas transferencia (no suma)" value={fmtGs(resumen.total_transferencia)} subtle />
          )}
          {resumen.ingresos_efectivo > 0 && (
            <Row label="+ Ingresos manuales" value={fmtGs(resumen.ingresos_efectivo)} />
          )}
          {resumen.egresos_efectivo > 0 && (
            <Row label="− Egresos manuales" value={`-${fmtGs(resumen.egresos_efectivo)}`} />
          )}
          {resumen.retiros_efectivo > 0 && (
            <Row label="− Retiros" value={`-${fmtGs(resumen.retiros_efectivo)}`} />
          )}
          <div className="border-t border-slate-200 mt-2 pt-2">
            <Row
              label="Efectivo esperado"
              value={fmtGs(esperado)}
              bold
              highlightTurquesa
            />
          </div>
        </div>

        {/* Toggle Contar/Monto oculto para Ferrecolor: solo monto directo. */}
        {false && <ModoArqueoToggle modo={modo} onChange={setModo} />}

        {modo === "arqueo" ? (
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
              Conteo del efectivo en mano
            </label>
            <ArqueoDenominaciones value={cant} onChange={setCant} disabled={busy} />
          </div>
        ) : (
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
              Efectivo contado (Gs.)
            </label>
            <MontoInput
              value={monto}
              onChange={(n) => setMonto(String(n))}
              decimals={false}
              autoFocus
              className="w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm font-semibold tabular-nums focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 outline-none"
            />
          </div>
        )}

        {/* Vista previa de diferencia */}
        <div
          className={`rounded-xl border-2 px-3 py-3 flex items-center justify-between ${
            diferencia === 0
              ? "border-emerald-200 bg-emerald-50/60 text-emerald-800"
              : diferencia > 0
              ? "border-sky-200 bg-sky-50/60 text-sky-800"
              : "border-red-200 bg-red-50/60 text-red-800"
          }`}
        >
          <span className="text-xs font-semibold flex items-center gap-1.5">
            {diferencia === 0 ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5" />
            )}
            Diferencia
          </span>
          <span className="text-base font-bold tabular-nums">
            {diferencia >= 0 ? "+" : "−"}
            {fmtGs(Math.abs(diferencia))}
          </span>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
            Observación (opcional)
          </label>
          <textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            rows={2}
            className="w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 outline-none resize-none"
            placeholder={
              diferencia !== 0
                ? "Sugerido: explicá la diferencia"
                : "Nota opcional del cierre"
            }
          />
        </div>

        {err && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {err}
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
          className="inline-flex items-center gap-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-bold px-5 py-2 transition-colors"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Cerrar caja
        </button>
      </div>
    </ModalBase>
  );
}

function ModalMovimiento({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (opts: {
    tipo: TipoMovimientoCaja;
    concepto: string;
    monto: number;
    medio_pago: MedioPagoCaja;
    observacion: string | null;
  }) => Promise<void>;
}) {
  const [tipo, setTipo] = useState<TipoMovimientoCaja>("ingreso");
  const [concepto, setConcepto] = useState("");
  const [monto, setMonto] = useState("0");
  const [medio, setMedio] = useState<MedioPagoCaja>("efectivo");
  const [obs, setObs] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    const n = Number(monto);
    if (!concepto.trim()) {
      setErr("Concepto requerido.");
      return;
    }
    if (!Number.isFinite(n)) {
      setErr("Monto inválido.");
      return;
    }
    if (tipo !== "ajuste" && n <= 0) {
      setErr("El monto debe ser > 0 (solo ajustes pueden ser negativos).");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onConfirm({
        tipo,
        concepto: concepto.trim(),
        monto: n,
        medio_pago: medio,
        observacion: obs.trim() || null,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
      setBusy(false);
    }
  }

  return (
    <ModalBase
      title="Registrar movimiento"
      subtitle="Ingresos/egresos manuales de la caja (no son ventas)."
      onClose={busy ? () => {} : onClose}
    >
      <div className="p-5 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
            Tipo
          </label>
          <div className="grid grid-cols-4 gap-1.5">
            {(["ingreso", "egreso", "retiro", "ajuste"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTipo(t)}
                className={`rounded-md py-1.5 text-xs font-bold border-2 transition-colors capitalize ${
                  tipo === t
                    ? "border-[#4FAEB2] bg-[#4FAEB2] text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
            Concepto
          </label>
          <input
            type="text"
            value={concepto}
            onChange={(e) => setConcepto(e.target.value)}
            placeholder="Ej: Pago de delivery, Vuelto, etc."
            maxLength={200}
            className="w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
              Monto (Gs.)
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
              Medio de pago
            </label>
            <select
              value={medio}
              onChange={(e) => setMedio(e.target.value as MedioPagoCaja)}
              className="w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 outline-none bg-white"
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
            Observación (opcional)
          </label>
          <textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            rows={2}
            className="w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 outline-none resize-none"
          />
        </div>
        {err && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {err}
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
    </ModalBase>
  );
}

function Row({
  label,
  value,
  bold,
  subtle,
  highlightTurquesa,
}: {
  label: string;
  value: string;
  bold?: boolean;
  subtle?: boolean;
  highlightTurquesa?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={`${bold ? "font-bold text-slate-800" : subtle ? "text-slate-400" : "text-slate-600"}`}>
        {label}
      </span>
      <span
        className={`tabular-nums ${
          bold ? "font-bold" : ""
        } ${highlightTurquesa ? "text-[#3F8E91] text-sm" : subtle ? "text-slate-400" : "text-slate-700"}`}
      >
        {value}
      </span>
    </div>
  );
}
