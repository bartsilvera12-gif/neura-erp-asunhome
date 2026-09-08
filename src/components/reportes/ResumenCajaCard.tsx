"use client";

/**
 * Sección "Resumen de Caja": efectivo esperado por el sistema vs. efectivo real
 * contado, con el desglose (saldo inicial, ventas en efectivo, otros ingresos,
 * egresos) y el estado de la diferencia (cuadrada / sobrante / faltante / sin
 * cierre). Reutilizable: la usan Reportes → Cierres de caja y Ventas por día.
 *
 * Toda la aritmética vive en @/lib/caja/resumen-caja (lógica pura, compartida
 * con los exports Excel). Este componente es solo presentación.
 */

import type { ResumenCaja, EstadoDiferenciaCaja } from "@/lib/caja/resumen-caja";
import { etiquetaEstadoDiferencia } from "@/lib/caja/resumen-caja";

function formatGs(v: number) {
  return `Gs. ${Math.round(v || 0).toLocaleString("es-PY")}`;
}

function fFecha(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(ymd)) return ymd;
  const [y, m, d] = ymd.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** Estilos del banner de estado, con los tokens de badge del ERP (claro/oscuro). */
const ESTADO_STYLE: Record<EstadoDiferenciaCaja, { bg: string; text: string }> = {
  cuadrada: { bg: "var(--badge-success-bg)", text: "var(--badge-success-text)" },
  sobrante: { bg: "var(--badge-warning-bg)", text: "var(--badge-warning-text)" },
  faltante: { bg: "var(--badge-error-bg)", text: "var(--badge-error-text)" },
  sin_cierre: { bg: "var(--surface-muted, #F1F5F9)", text: "#475569" },
};

function Tile({
  label,
  value,
  hint,
  accent,
  signo,
}: {
  label: string;
  value: string;
  hint?: string;
  /** Resalta el valor en turquesa (métrica principal: Saldo esperado). */
  accent?: boolean;
  /** Colorea el valor: 1 = ingreso (verde), -1 = egreso (rojo). */
  signo?: 1 | -1;
}) {
  const valueColor = accent
    ? "text-[#3F8E91]"
    : signo === 1
    ? "text-emerald-700"
    : signo === -1
    ? "text-red-600"
    : "text-slate-800";
  return (
    <div className={`rounded-xl border p-3 ${accent ? "border-[#4FAEB2]/40 bg-[#4FAEB2]/[0.07]" : "border-slate-200 bg-white"}`}>
      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-0.5 text-sm font-bold tabular-nums ${valueColor}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

export default function ResumenCajaCard({
  resumen,
  desde,
  hasta,
  className,
}: {
  resumen: ResumenCaja;
  desde: string;
  hasta: string;
  className?: string;
}) {
  const unSoloDia = desde === hasta;
  const periodo = unSoloDia ? `del ${fFecha(desde)}` : `del ${fFecha(desde)} al ${fFecha(hasta)}`;
  const estadoStyle = ESTADO_STYLE[resumen.estado];
  const tieneCierre = resumen.efectivo_real != null && resumen.diferencia != null;

  // Texto del banner de estado (lo más importante después del saldo esperado).
  const bannerLabel = tieneCierre
    ? resumen.diferencia === 0
      ? "Caja cuadrada"
      : `${etiquetaEstadoDiferencia(resumen.estado)}: ${formatGs(Math.abs(resumen.diferencia as number))}`
    : "Caja aún no cerrada";

  const turnosHint =
    resumen.cajas_total === 0
      ? "Sin turnos de caja en el período"
      : `${resumen.cajas_total} turno(s) · ${resumen.cajas_cerradas} cerrado(s) · ${resumen.cajas_abiertas} abierto(s)`;

  return (
    <section
      className={`rounded-2xl border border-[#4FAEB2]/30 bg-white p-6 shadow-sm ring-1 ring-[#4FAEB2]/10 ${className ?? ""}`}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700">
          <span className="inline-block h-3.5 w-1 rounded-full bg-[#4FAEB2]" />
          Resumen de Caja
        </h2>
        <span className="text-[11px] text-slate-400">Efectivo esperado vs. real · {periodo}</span>
      </div>

      {/* Fila principal: Saldo esperado + Diferencia/estado (lo más importante). */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border-2 border-[#4FAEB2]/40 bg-[#4FAEB2]/[0.07] p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Saldo esperado</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-[#3F8E91]">{formatGs(resumen.saldo_esperado)}</p>
          <p className="mt-0.5 text-[11px] text-slate-400">Lo que el sistema espera en caja</p>
        </div>
        <div
          className="rounded-xl border-2 p-4"
          style={{ backgroundColor: estadoStyle.bg, borderColor: estadoStyle.bg }}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: estadoStyle.text, opacity: 0.85 }}>
            Diferencia
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums" style={{ color: estadoStyle.text }}>
            {tieneCierre
              ? `${(resumen.diferencia as number) > 0 ? "+" : (resumen.diferencia as number) < 0 ? "−" : ""}${formatGs(Math.abs(resumen.diferencia as number))}`
              : "—"}
          </p>
          <p className="mt-0.5 text-[11px] font-semibold" style={{ color: estadoStyle.text }}>
            {bannerLabel}
          </p>
        </div>
      </div>

      {/* Desglose */}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Tile label="Saldo inicial" value={formatGs(resumen.saldo_inicial)} hint="Apertura de turnos" />
        <Tile label="Ventas en efectivo" value={formatGs(resumen.ventas_efectivo)} signo={1} />
        <Tile label="Otros ingresos" value={formatGs(resumen.otros_ingresos)} signo={1} hint="Ingresos manuales" />
        <Tile label="Egresos" value={formatGs(resumen.egresos)} signo={-1} hint="Retiros, pagos, egresos" />
        <Tile
          label="Efectivo real"
          value={tieneCierre ? formatGs(resumen.efectivo_real as number) : "Sin cierre"}
          hint={tieneCierre ? "Contado al cierre" : "Caja aún no cerrada"}
        />
      </div>

      <p className="mt-3 text-[11px] text-slate-400">
        {turnosHint}. Solo cuenta efectivo (no tarjeta ni transferencia) y excluye ventas anuladas, devueltas y a crédito.
        {resumen.cajas_abiertas > 0 && resumen.cajas_total > 0
          ? " La diferencia se muestra recién cuando todos los turnos del período están cerrados."
          : ""}
      </p>
    </section>
  );
}
