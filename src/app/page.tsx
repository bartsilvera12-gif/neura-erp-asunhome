"use client";

import { memo, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import {
  BarChart3, Wallet, Package, ShoppingCart, Truck,
  Target, MessageCircle, CheckCircle2, TrendingUp,
  Hash, AlertTriangle, Gem, Calendar, CalendarDays,
  Receipt, Boxes, DollarSign,
  type LucideIcon,
} from "lucide-react";
// MobileDashboard se renderiza solo en mobile (md:hidden). El dashboard desktop
// que vive en este mismo archivo queda intacto.
import MobileDashboard from "@/app/_components/MobileDashboard";
import CobranzasResumenCards from "@/components/cobros/CobranzasResumenCards";
import { getConfig } from "@/lib/config/storage";
import { getUsuarios } from "@/lib/usuarios/storage";
import type { ConfigGlobal } from "@/lib/config/types";
import type { Usuario } from "@/lib/usuarios/types";
import {
  esFacturaAnulada,
  esFacturaCorregidaNc,
  buildMontoNcAprobadaPorFacturaId,
  montoFacturaNetoValorComercial,
  getDashboardData,
  type ProspectoRaw,
  type ClienteRaw,
  type FacturaRaw,
  type PagoRaw,
  type TipificacionRaw,
  type ProductoRaw,
  type VentaRaw,
  type CompraRaw,
  type GastoRaw,
  type SuscripcionDashRow,
  type NotaCreditoDashRow,
} from "@/lib/dashboard/data";
import {
  enRangoCalendario,
  enMesCalendarioActual,
  hoyYmdLocal,
  rangoMesCalendarioLocal,
  toCalendarDateStr,
} from "@/lib/fechas/calendario";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { etiquetaVisibleTipoServicio } from "@/lib/clientes/tipo-servicio-catalogo";
import { useMapNombreTipoServicioCatalogo } from "@/lib/clientes/use-map-nombre-tipo-servicio";
import { getEtapas, getEtapaClasses, normalizeEtapaCodigo, type EtapaCrm } from "@/lib/crm/etapas";
import {
  isDashboardTabSlug,
  type DashboardTabSlug,
} from "@/lib/dashboard/resolve-effective-dashboard-views";
// recharts (~90 KB gzipped) extraido a archivo aparte y dynamic-importado.
// Razones:
//  - El chart solo se ve cuando el user entra al tab "Financiero" del dashboard.
//  - LineChart hace introspeccion de children por tipo — por eso NO se puede
//    dynamic() directo a los componentes individuales (rompe los ejes).
//    Solucion: dynamic() al chart completo como unidad cerrada.
//  - ssr:false porque el chart no aporta SEO y evita un round-trip server.
//  - loading: placeholder con la misma altura para que no haya layout shift.
const ChartCobradoPorDia = dynamic(
  () => import("@/app/_components/ChartCobradoPorDia"),
  {
    ssr: false,
    loading: () => <div className="h-full w-full animate-pulse rounded-lg bg-slate-100" />,
  },
);

// ── ZENTRA (solo dashboard / esta página) ─────────────────────────────────────
// Paleta turquesa #4FAEB2 (rediseño 2026). Shell BLANCO con detalles turquesa
// (paleta dashboard Zentra). Cards blancas con ring turquesa, texto en slate
// oscuro, acentos en #4FAEB2.
const Z = {
  bg:       "#F8FAFC",      // app shell background
  surface:  "#FFFFFF",       // card surface
  card:     "#FFFFFF",       // card interior
  accent:   "#4FAEB2",       // turquesa principal
  accentHover: "#3F8E91",    // turquesa hover/dark
  text:     "#0F172A",       // slate-900 para texto principal
  muted:    "#64748B",       // slate-500 para texto secundario
  success:  "#22C55E",
  error:    "#EF4444",
} as const;

function ZentraMark({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#4FAEB2]/30 bg-white shadow-sm ring-1 ring-[#4FAEB2]/10 ${className}`}
    >
      <span className="text-xl font-extrabold leading-none tracking-tight" style={{ color: Z.accent }}>
        Z
      </span>
    </div>
  );
}

function labelClienteDimension(raw: string): string {
  const s = raw.trim();
  if (!s) return "Sin clasificar";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase().replace(/_/g, " ");
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Periodo = "hoy" | "7d" | "30d" | "mes" | "anio";
type TabDash = DashboardTabSlug;

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatGs(n: number): string {
  return n.toLocaleString("es-PY");
}

/**
 * Formato completo con separadores de miles. Para KPIs operativas donde el
 * usuario necesita ver el monto real (ej. "Gs. 286.000" en lugar de "286K").
 * Solo abrevia cuando el numero es muy grande (>= 1.000 millones) y mostrarlo
 * completo romperia la tarjeta.
 */
function formatGsFull(n: number): string {
  const num = Number(n);
  if (!Number.isFinite(num)) return "0";
  if (Math.abs(num) >= 1_000_000_000) {
    const b = num / 1_000_000_000;
    return `${b.toFixed(2).replace(".", ",")} MM`;
  }
  return Math.round(num).toLocaleString("es-PY");
}

/** Formato abreviado (mantengo para charts/ejes donde el espacio es limitado). */
function formatGsM(n: number): string {
  const num = Number(n);
  if (!Number.isFinite(num) || num < 0) return "0";
  if (num >= 1_000_000_000) {
    const b = num / 1_000_000_000;
    return b % 1 === 0 ? `${b}B` : `${b.toFixed(1)}B`;
  }
  if (num >= 1_000_000) {
    const m = num / 1_000_000;
    return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M`;
  }
  if (num >= 1_000) return `${Math.round(num / 1_000)}K`;
  return num.toLocaleString("es-PY");
}

function formatFecha(s: string): string {
  const cal = s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(cal)) {
    const [y, m, d] = cal.split("-");
    return `${d}/${m}/${y}`;
  }
  const dt = new Date(s);
  if (isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Hoy en Paraguay (UTC-3 fijo desde 2024), independiente del tz del navegador. */
function ahoraPY(): Date {
  const now = new Date();
  // Aplicamos offset -3h y usamos los componentes UTC como si fueran locales
  // para construir una Date con los YMD/HMS de Paraguay.
  const shifted = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return new Date(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
    shifted.getUTCHours(),
    shifted.getUTCMinutes(),
    shifted.getUTCSeconds(),
    shifted.getUTCMilliseconds()
  );
}

function getRango(periodo: Periodo): { desde: Date; hasta: Date } {
  const ahora = ahoraPY();
  switch (periodo) {
    case "mes":
      return rangoMesCalendarioLocal(ahora);
    case "hoy": {
      const desde = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 0, 0, 0, 0);
      const hasta = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 23, 59, 59, 999);
      return { desde, hasta };
    }
    case "7d": {
      const hasta = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 23, 59, 59, 999);
      const desde = new Date(ahora);
      desde.setDate(desde.getDate() - 7);
      desde.setHours(0, 0, 0, 0);
      return { desde, hasta };
    }
    case "30d": {
      const hasta = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 23, 59, 59, 999);
      const desde = new Date(ahora);
      desde.setDate(desde.getDate() - 30);
      desde.setHours(0, 0, 0, 0);
      return { desde, hasta };
    }
    case "anio": {
      const desde = new Date(ahora.getFullYear(), 0, 1, 0, 0, 0, 0);
      const hasta = new Date(ahora.getFullYear(), 11, 31, 23, 59, 59, 999);
      return { desde, hasta };
    }
    default:
      return rangoMesCalendarioLocal(ahora);
  }
}

/** Fecha pura YYYY-MM-DD: comparación calendario (sin UTC). ISO con hora: rango por instante. */
function enRango(fechaStr: string | null | undefined, desde: Date, hasta: Date): boolean {
  const t = String(fechaStr ?? "").trim();
  if (!t) return false;
  const cal = t.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(cal) && t.length <= 10) {
    return enRangoCalendario(cal, desde, hasta);
  }
  const f = new Date(t);
  return !isNaN(f.getTime()) && f >= desde && f <= hasta;
}

/** Cada día calendario entre `desde` y `hasta` (inclusive), en YYYY-MM-DD local. */
function listarDiasCalendarioYmd(desde: Date, hasta: Date): string[] {
  const out: string[] = [];
  const cur = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate());
  const end = new Date(hasta.getFullYear(), hasta.getMonth(), hasta.getDate());
  while (cur.getTime() <= end.getTime()) {
    out.push(hoyYmdLocal(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

// ── Componentes de gráficos ───────────────────────────────────────────────────

/** Fila de pipeline: etiquetas y colores vienen de `crm_etapas` (getEtapas), no de listas fijas en el dashboard. */
type PipelineBarRowZ = { rowKey: string; label: string; count: number; valor: number; dotClass: string; barClass: string };

function PipelineBar({ data, tone = "light" }: { data: PipelineBarRowZ[]; tone?: "light" | "zentra" }) {
  const maxC = Math.max(...data.map((d) => d.count), 1);
  const z = tone === "zentra";
  return (
    <div className="space-y-3">
      {data.map((d) => (
        <div key={d.rowKey}>
          <div className="mb-1 flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <div className={`h-2 w-2 shrink-0 rounded-full ${d.dotClass}`} />
              <span
                className={`text-xs font-medium truncate ${z ? "" : "text-gray-700"}`}
                style={z ? { color: Z.text } : undefined}
                title={d.label}
              >
                {d.label}
              </span>
            </div>
            <div
              className={`ml-2 flex shrink-0 items-center gap-4 text-xs ${z ? "" : "text-gray-500"}`}
              style={z ? { color: Z.muted } : undefined}
            >
              <span className={`tabular-nums font-semibold ${z ? "" : "text-gray-700"}`} style={z ? { color: Z.text } : undefined}>
                {d.count}
              </span>
              <span className="w-20 text-right tabular-nums">Gs. {formatGsM(d.valor)}</span>
            </div>
          </div>
          <div
            className={`h-5 overflow-hidden rounded-full ${z ? "" : "bg-gray-100"}`}
            style={z ? { backgroundColor: "rgba(255,255,255,0.08)" } : undefined}
          >
            <div
              className={`h-full rounded-full transition-all ${d.barClass}`}
              style={{ width: `${d.count > 0 ? Math.max((d.count / maxC) * 100, 4) : 0}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function HBarChart({
  data,
  color = "bg-blue-400",
  tone = "light",
}: { data: { label: string; value: number }[]; color?: string; tone?: "light" | "zentra" }) {
  const max = Math.max(...data.map(d => d.value), 1);
  const z = tone === "zentra";
  return (
    <div className="space-y-2">
      {data.slice(0, 8).map((d, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className={`w-28 shrink-0 truncate text-xs ${z ? "" : "text-gray-600"}`} style={z ? { color: Z.muted } : undefined} title={d.label}>
            {d.label}
          </span>
          <div className={`h-5 flex-1 overflow-hidden rounded-full ${z ? "" : "bg-gray-100"}`} style={z ? { backgroundColor: "rgba(255,255,255,0.08)" } : undefined}>
            <div
              className={`h-full rounded-full ${color} transition-all`}
              style={{ width: `${d.value > 0 ? Math.max((d.value / max) * 100, 3) : 0}%` }}
            />
          </div>
          <span className={`w-8 shrink-0 text-right text-xs font-semibold tabular-nums ${z ? "" : "text-gray-700"}`} style={z ? { color: Z.text } : undefined}>
            {d.value}
          </span>
        </div>
      ))}
      {data.length === 0 && (
        <p className={`py-4 text-center text-xs ${z ? "" : "text-gray-400"}`} style={z ? { color: Z.muted } : undefined}>
          Sin datos
        </p>
      )}
    </div>
  );
}

function AreaChart({
  data, color = "#6366f1",
}: { data: { label: string; value: number }[]; color?: string }) {
  if (data.length < 2) return <p className="text-xs text-gray-400 py-8 text-center">Sin datos suficientes</p>;
  const W = 480, H = 130, PL = 48, PR = 8, PT = 8, PB = 24;
  const cW = W - PL - PR, cH = H - PT - PB;
  const max = Math.max(...data.map(d => d.value), 1);
  const pts = data.map((d, i) => ({
    x: PL + (i / (data.length - 1)) * cW,
    y: PT + cH - (d.value / max) * cH,
  }));
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1].x.toFixed(1)},${(PT + cH).toFixed(1)} L${PL},${(PT + cH).toFixed(1)} Z`;
  const yTicks = [0, Math.floor(max / 2), max];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
      {yTicks.map((v, i) => {
        const y = PT + cH - (v / max) * cH;
        return (
          <g key={i}>
            <line x1={PL} y1={y} x2={W - PR} y2={y} stroke="#f3f4f6" strokeWidth="1" />
            <text x={PL - 4} y={y + 3} textAnchor="end" fontSize="9" fill="#9ca3af">
              {formatGsM(v)}
            </text>
          </g>
        );
      })}
      <path d={area} fill={color} fillOpacity="0.12" />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="2.5" fill={color} />)}
      {data.map((d, i) =>
        i % 2 === 0 ? (
          <text key={i} x={pts[i].x} y={H - 4} textAnchor="middle" fontSize="9" fill="#9ca3af">
            {d.label}
          </text>
        ) : null
      )}
    </svg>
  );
}

function DonutChart({
  segments,
  centerLabel = "total",
  formatValue = (v: number) => String(v),
  variant = "light",
  legendDetail = false,
}: {
  segments: { label: string; value: number; color: string }[];
  centerLabel?: string;
  formatValue?: (v: number) => string;
  variant?: "light" | "zentra";
  /** Muestra cantidad y % sobre el total en la leyenda */
  legendDetail?: boolean;
}) {
  const total = segments.reduce((s, g) => s + g.value, 0);
  const isZ = variant === "zentra";
  if (total === 0) {
    return (
      <div className="flex items-center gap-6">
        <div
          className={`flex h-32 w-32 shrink-0 items-center justify-center rounded-full ${isZ ? "border border-slate-200" : "bg-gray-100"}`}
          style={isZ ? { backgroundColor: Z.surface } : undefined}
        >
          <span className={`text-xs ${isZ ? "" : "text-gray-400"}`} style={isZ ? { color: Z.muted } : undefined}>
            Sin datos
          </span>
        </div>
      </div>
    );
  }
  const R = 50, CX = 80, CY = 80, C = 2 * Math.PI * R;
  let cum = 0;
  const fillCenter = isZ ? Z.text : "#1f2937";
  const fillSub = isZ ? Z.muted : "#9ca3af";
  return (
    <div className="flex flex-col items-stretch gap-6 sm:flex-row sm:items-center">
      <svg viewBox="0 0 160 160" className="mx-auto h-36 w-36 shrink-0 sm:mx-0">
        {segments.map((seg, i) => {
          if (seg.value === 0) return null;
          const pct = seg.value / total;
          const dash = pct * C;
          const rot = cum * 360 - 90;
          cum += pct;
          return (
            <circle
              key={i}
              cx={CX}
              cy={CY}
              r={R}
              fill="none"
              stroke={seg.color}
              strokeWidth="22"
              strokeDasharray={`${dash} ${C - dash}`}
              transform={`rotate(${rot} ${CX} ${CY})`}
            />
          );
        })}
        <text x={CX} y={CY + 5} textAnchor="middle" fontSize="17" fontWeight="bold" fill={fillCenter}>
          {formatValue(total)}
        </text>
        <text x={CX} y={CY + 20} textAnchor="middle" fontSize="9" fill={fillSub}>
          {centerLabel}
        </text>
      </svg>
      <div className="min-w-0 flex-1 space-y-2.5">
        {segments.map((seg, i) => {
          const pct = total > 0 ? (seg.value / total) * 100 : 0;
          return (
            <div key={i} className="flex items-center gap-2.5">
              <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: seg.color }} />
              <span
                className={`min-w-0 flex-1 truncate text-xs ${isZ ? "" : "text-gray-600"}`}
                style={isZ ? { color: Z.text } : undefined}
                title={seg.label}
              >
                {seg.label}
              </span>
              {legendDetail ? (
                <span
                  className="shrink-0 text-xs font-semibold tabular-nums"
                  style={{ color: isZ ? Z.muted : "#1f2937" }}
                >
                  {formatValue(seg.value)} · {pct.toFixed(1)}%
                </span>
              ) : (
                <span className={`shrink-0 text-xs font-bold tabular-nums ${isZ ? "" : "text-gray-800"}`} style={isZ ? { color: Z.muted } : undefined}>
                  {formatValue(seg.value)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProgressBar({
  label,
  value,
  meta,
  format = "number",
  variant = "light",
}: {
  label: string;
  value: number;
  meta: number;
  format?: "number" | "gs" | "pct";
  variant?: "light" | "zentra";
}) {
  const valueN = Number(value);
  const metaN = Number(meta);
  const v = Number.isFinite(valueN) ? valueN : 0;
  const m = Number.isFinite(metaN) && metaN > 0 ? metaN : 0;
  const pct = m > 0 ? Math.min((v / m) * 100, 100) : 0;
  const color =
    variant === "zentra"
      ? pct >= 100
        ? Z.success
        : pct >= 70
          ? "#F59E0B"
          : Z.accent
      : null;
  const barClass =
    variant === "light"
      ? pct >= 100
        ? "bg-green-500"
        : pct >= 70
          ? "bg-amber-400"
          : "bg-blue-500"
      : "";
  const fmt = (n: number) =>
    format === "gs" ? `Gs. ${formatGsM(n)}` : format === "pct" ? `${n.toFixed(1)}%` : String(n);
  const metaLabel =
    m > 0 ? fmt(m) : format === "gs" ? "sin meta" : "—";
  const isZ = variant === "zentra";

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className={`text-xs font-semibold ${isZ ? "" : "text-gray-700"}`} style={isZ ? { color: Z.text } : undefined}>
          {label}
        </span>
        <span className={`text-xs tabular-nums ${isZ ? "" : "text-gray-500"}`} style={isZ ? { color: Z.muted } : undefined}>
          {fmt(v)} <span style={{ color: isZ ? "rgba(255,255,255,0.2)" : "#d1d5db" }}>/</span> {metaLabel}
        </span>
      </div>
      <div className={`h-2 overflow-hidden rounded-full ${isZ ? "" : "bg-gray-100"}`} style={isZ ? { backgroundColor: "rgba(255,255,255,0.08)" } : undefined}>
        <div
          className={`h-full rounded-full transition-all ${barClass}`}
          style={isZ ? { width: `${pct}%`, backgroundColor: color ?? Z.accent } : { width: `${pct}%` }}
        />
      </div>
      <p className={`mt-1 text-xs ${isZ ? "" : "text-gray-400"}`} style={isZ ? { color: Z.muted } : undefined}>
        {pct.toFixed(0)}% de la meta
      </p>
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  color = "text-[#0F172A]",
  icon: IconCmp,
  variation,
  variant = "light",
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  icon: LucideIcon;
  variation?: number;
  variant?: "light" | "zentra";
}) {
  if (variant === "zentra") {
    return (
      <motion.div
        whileHover={{ y: -2 }}
        className="rounded-2xl border border-slate-200 p-6 shadow-lg shadow-black/10"
        style={{ backgroundColor: Z.card }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#4FAEB2]/15 text-[#3F8E91]">
            <IconCmp className="h-5 w-5" strokeWidth={2} />
          </div>
          {variation !== undefined && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold"
              style={{
                backgroundColor: variation >= 0 ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)",
                color: variation >= 0 ? Z.success : Z.error,
              }}
            >
              {variation >= 0 ? "+" : ""}
              {variation}%
            </span>
          )}
        </div>
        <p className={`mt-3 text-3xl font-bold tabular-nums ${color}`}>{value}</p>
        <p className="mt-1 text-xs font-medium" style={{ color: Z.muted }}>
          {label}
        </p>
        {sub && (
          <p className="mt-1 text-xs" style={{ color: Z.muted }}>
            {sub}
          </p>
        )}
      </motion.div>
    );
  }
  return (
    <motion.div
      whileHover={{ y: -2 }}
      className="rounded-2xl border border-[#4FAEB2]/30 bg-white p-6 shadow-sm ring-1 ring-[#4FAEB2]/10 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#4FAEB2]/12 text-[#3F8E91]">
          <IconCmp className="h-5 w-5" strokeWidth={2} />
        </div>
        {variation !== undefined && (
          <span
            className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold ${
              variation >= 0 ? "bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]" : "bg-[var(--badge-error-bg)] text-[var(--badge-error-text)]"
            }`}
          >
            {variation >= 0 ? "+" : ""}
            {variation}%
          </span>
        )}
      </div>
      <p className={`mt-3 text-2xl xl:text-3xl font-bold tabular-nums leading-tight tracking-tight ${color}`}>{value}</p>
      <p className="mt-1 text-xs font-medium text-[#475569]">{label}</p>
      {sub && <p className="mt-1 text-xs text-[#475569]">{sub}</p>}
    </motion.div>
  );
}

// ── Dashboard Comercial ───────────────────────────────────────────────────────

/** Valor comercial del cliente en el período: 1) facturas netas (NC aprobadas) en período, 2) suscripción alta/inicio en período. */
function valorComercialClienteEnPeriodo(
  clienteId: string | number,
  facturas: FacturaRaw[],
  ncPorFactura: Map<string, number>,
  suscripciones: SuscripcionDashRow[],
  desde: Date,
  hasta: Date
): { monto: number; fuente: "facturas" | "suscripcion" | "sin_dato" } {
  const id = String(clienteId);
  const sumF = facturas
    .filter((f) => String(f.cliente_id) === id && enRango(f.fecha, desde, hasta))
    .reduce((s, f) => s + montoFacturaNetoValorComercial(f, ncPorFactura), 0);
  if (sumF > 0) return { monto: sumF, fuente: "facturas" };

  let sumS = 0;
  for (const s of suscripciones) {
    if (String(s.cliente_id) !== id) continue;
    if (enRango(s.fecha_inicio, desde, hasta) || enRango(s.created_at, desde, hasta)) {
      sumS += Number(s.precio) || 0;
    }
  }
  if (sumS > 0) return { monto: sumS, fuente: "suscripcion" };
  return { monto: 0, fuente: "sin_dato" };
}

function etiquetaPlanServicioCliente(
  c: ClienteRaw,
  mapNombreTipoServicio: Readonly<Record<string, string>>
) {
  const t = (c.tipo_servicio_cliente ?? "").trim();
  if (t) return etiquetaVisibleTipoServicio(t, mapNombreTipoServicio);
  const co = (c.condicion_pago ?? "").trim();
  if (co) return labelClienteDimension(co);
  return "—";
}

// memo evita re-render de este sub-dashboard cuando cambia algo en el padre
// que no afecta a sus props (ej: usuario abre dropdown del header, cambia tab,
// se actualizan KPIs de otra seccion). Los datos del comercial son grandes
// (prospectos+clientes+facturas+notasCredito+suscripciones) y los useMemo
// internos solo se cachean si el componente no re-renderea.
const DashComercial = memo(function DashComercial({
  prospectos,
  clientes,
  mapNombreTipoServicio,
  tipificaciones: _tipificaciones,
  usuario,
  periodo,
  config,
  facturas,
  notasCredito,
  suscripciones,
}: {
  prospectos: ProspectoRaw[];
  clientes: ClienteRaw[];
  mapNombreTipoServicio: Readonly<Record<string, string>>;
  tipificaciones: TipificacionRaw[];
  usuario: Usuario | null;
  periodo: Periodo;
  config: ConfigGlobal;
  facturas: FacturaRaw[];
  notasCredito: NotaCreditoDashRow[];
  suscripciones: SuscripcionDashRow[];
}) {
  void _tipificaciones;
  const { desde, hasta } = useMemo(() => getRango(periodo), [periodo]);

  const [etapasCrmCatalog, setEtapasCrmCatalog] = useState<EtapaCrm[]>([]);
  useEffect(() => {
    void getEtapas().then(setEtapasCrmCatalog);
  }, []);

  const ncPorFactura = useMemo(() => buildMontoNcAprobadaPorFacturaId(notasCredito), [notasCredito]);

  const isSupervisor = usuario?.nivel === "supervisor";
  const area = usuario?.area;

  const prospectosFilt = useMemo(
    () =>
      prospectos.filter((p) => {
        if (isSupervisor && area === "ventas" && p.responsable)
          return p.responsable.toUpperCase() === usuario?.nombre.toUpperCase();
        return true;
      }),
    [prospectos, isSupervisor, area, usuario]
  );

  const leadsNuevos = prospectosFilt.filter((p) => enRango(p.fecha_creacion, desde, hasta)).length;
  const enNegociacion = prospectosFilt.filter(
    (p) => normalizeEtapaCodigo(p.etapa) === "NEGOCIACION"
  ).length;
  const clientesGanados = prospectosFilt.filter(
    (p) => normalizeEtapaCodigo(p.etapa) === "GANADO" && enRango(p.fecha_actualizacion, desde, hasta)
  ).length;
  const totalLeadsPeriodo = prospectosFilt.filter((p) => enRango(p.fecha_creacion, desde, hasta)).length;
  const tasaConversion = totalLeadsPeriodo > 0 ? (clientesGanados / totalLeadsPeriodo) * 100 : 0;

  /** Misma fuente que el CRM Funnel: columnas = etapas activas en `crm_etapas` (orden + nombre a mostrar). */
  const pipeline: PipelineBarRowZ[] = useMemo(() => {
    const inFil = (cod: string) =>
      prospectosFilt.filter((p) => normalizeEtapaCodigo(p.etapa) === normalizeEtapaCodigo(cod));
    const actives = [...etapasCrmCatalog]
      .filter((e) => e.activo)
      .sort((a, b) => a.orden - b.orden);
    const fromCatalog: PipelineBarRowZ[] = actives.map((e) => {
      const { dot, headerBg } = getEtapaClasses(e.color);
      const list = inFil(e.codigo);
      return {
        rowKey: e.id,
        label: e.nombre,
        count: list.length,
        valor: list.reduce((s, p) => s + (p.valor_estimado ?? 0), 0),
        dotClass: dot,
        barClass: headerBg,
      };
    });
    const catalogNorm = new Set(actives.map((e) => normalizeEtapaCodigo(e.codigo)));
    const extraCodes = new Set<string>();
    for (const p of prospectosFilt) {
      const c = normalizeEtapaCodigo(p.etapa);
      if (c && !catalogNorm.has(c)) extraCodes.add(c);
    }
    const fromExtras: PipelineBarRowZ[] = [...extraCodes].sort().map((code) => {
      const list = inFil(code);
      return {
        rowKey: `x-${code}`,
        label: code,
        count: list.length,
        valor: list.reduce((s, p) => s + (p.valor_estimado ?? 0), 0),
        dotClass: "bg-gray-400",
        barClass: "bg-gray-400",
      };
    });
    return [...fromCatalog, ...fromExtras];
  }, [etapasCrmCatalog, prospectosFilt]);

  const topPlanesEnNegociacion = useMemo(() => {
    const enNeg = prospectosFilt.filter((p) => normalizeEtapaCodigo(p.etapa) === "NEGOCIACION");
    const porPlan: Record<string, number> = {};
    for (const p of enNeg) {
      const plan = (p.servicio ?? "").trim() || "Otros";
      porPlan[plan] = (porPlan[plan] ?? 0) + (p.valor_estimado ?? 0);
    }
    return Object.entries(porPlan)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [prospectosFilt]);

  const topPlanesVendidos = useMemo(() => {
    const ganadosPeriodo = prospectosFilt.filter(
      (p) => normalizeEtapaCodigo(p.etapa) === "GANADO" && enRango(p.fecha_actualizacion, desde, hasta)
    );
    const porPlan: Record<string, number> = {};
    for (const p of ganadosPeriodo) {
      const planes = (p.servicio ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      for (const plan of planes.length ? planes : ["Otros"]) {
        const key = plan || "Otros";
        porPlan[key] = (porPlan[key] ?? 0) + 1;
      }
    }
    return Object.entries(porPlan)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [prospectosFilt, desde, hasta]);

  const rendimiento = useMemo(() => {
    const map: Record<string, number> = {};
    prospectosFilt
      .filter(
        (p) => normalizeEtapaCodigo(p.etapa) === "GANADO" && enRango(p.fecha_actualizacion, desde, hasta)
      )
      .forEach((p) => {
        const v = p.responsable ?? "Sin asignar";
        map[v] = (map[v] ?? 0) + 1;
      });
    return Object.entries(map)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [prospectosFilt, desde, hasta]);

  const filasClientesPeriodo = useMemo(() => {
    const nuevos = clientes.filter((c) => enRango(c.created_at, desde, hasta));
    return nuevos
      .map((c) => {
        const { monto, fuente } = valorComercialClienteEnPeriodo(
          c.id,
          facturas,
          ncPorFactura,
          suscripciones,
          desde,
          hasta
        );
        return {
          id: String(c.id),
          nombre: c.empresa ?? c.nombre_contacto,
          fechaAlta: c.created_at,
          planServicio: etiquetaPlanServicioCliente(c, mapNombreTipoServicio),
          monto,
          fuente,
          vendedor: c.vendedor_asignado?.trim() || "—",
        };
      })
      .sort((a, b) => new Date(b.fechaAlta).getTime() - new Date(a.fechaAlta).getTime());
  }, [clientes, facturas, ncPorFactura, suscripciones, desde, hasta, mapNombreTipoServicio]);

  const totalValorClientesNuevos = filasClientesPeriodo.reduce((s, r) => s + r.monto, 0);
  const nClientesNuevos = filasClientesPeriodo.length;
  const ticketPromedio = nClientesNuevos > 0 ? totalValorClientesNuevos / nClientesNuevos : 0;

  const panelClass = "rounded-2xl border border-slate-200 p-6 shadow-lg shadow-black/10 sm:p-8";
  const panelStyle = { backgroundColor: Z.card } as const;
  const titleClass = "text-xs font-bold uppercase tracking-wider";
  const titleStyle = { color: Z.muted } as const;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          variant="zentra"
          icon={Target}
          label="Leads nuevos"
          value={String(leadsNuevos)}
          color="text-[#60A5FA]"
          variation={12}
        />
        <KpiCard variant="zentra" icon={MessageCircle} label="En negociación" value={String(enNegociacion)} color="text-amber-400" />
        <KpiCard
          variant="zentra"
          icon={CheckCircle2}
          label="Clientes ganados (CRM)"
          value={String(clientesGanados)}
          color="text-[#60A5FA]"
          variation={8}
        />
        <KpiCard
          variant="zentra"
          icon={TrendingUp}
          label="Tasa de conversión"
          value={`${tasaConversion.toFixed(1)}%`}
          color={tasaConversion >= config.meta_conversion_leads ? "text-emerald-400" : "text-white"}
          variation={tasaConversion >= config.meta_conversion_leads ? 5 : -2}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <motion.div whileHover={{ y: -2 }} className={panelClass} style={panelStyle}>
          <h3 className={titleClass} style={titleStyle}>
            Pipeline CRM
          </h3>
          <div className="mt-5">
            <PipelineBar data={pipeline} tone="zentra" />
          </div>
        </motion.div>
        <motion.div whileHover={{ y: -2 }} className={panelClass} style={panelStyle}>
          <h3 className={titleClass} style={titleStyle}>
            Clientes ganados por vendedor
          </h3>
          <div className="mt-5">
            <HBarChart data={rendimiento} color="bg-[#2563EB]" tone="zentra" />
          </div>
        </motion.div>
      </div>

      <motion.div whileHover={{ y: -2 }} className={panelClass} style={panelStyle}>
        <h3 className={titleClass} style={titleStyle}>
          Top planes vendidos · período seleccionado
        </h3>
        <div className="mt-5">
          <HBarChart data={topPlanesVendidos} color="bg-emerald-500" tone="zentra" />
        </div>
      </motion.div>

      <motion.div whileHover={{ y: -2 }} className={panelClass} style={panelStyle}>
        <h3 className={titleClass} style={titleStyle}>
          Top planes en negociación
        </h3>
        {topPlanesEnNegociacion.length === 0 ? (
          <p className="mt-6 text-center text-sm" style={{ color: Z.muted }}>
            Sin prospectos en negociación
          </p>
        ) : (
          <div className="mt-6">
            <DonutChart
              variant="zentra"
              legendDetail
              segments={topPlanesEnNegociacion.map((d, i) => ({
                label: d.label,
                value: d.value,
                color: ["#F59E0B", "#F97316", "#FB923C", "#FDBA74", "#FED7AA"][i] ?? "#9ca3af",
              }))}
              centerLabel="monto total"
              formatValue={(v) => formatGsM(v)}
            />
          </div>
        )}
      </motion.div>

      <motion.div
        whileHover={{ y: -3 }}
        className="rounded-2xl border p-6 shadow-xl shadow-black/25 sm:p-10"
        style={{ backgroundColor: Z.surface, borderColor: "rgba(37,99,235,0.35)" }}
      >
        <div className="flex flex-col gap-2 border-b border-slate-200 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: Z.accent }}>
              Cartera · período
            </p>
            <h2 className="mt-2 text-xl font-bold tracking-tight sm:text-2xl" style={{ color: Z.text }}>
              Clientes del período
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed" style={{ color: Z.muted }}>
              Altas con <strong style={{ color: Z.text }}>fecha de creación</strong> en el rango del filtro. Valor: suma de{" "}
              <strong style={{ color: Z.text }}>facturas emitidas en el período</strong> por cliente (neto de{" "}
              <strong style={{ color: Z.text }}>notas de crédito aprobadas</strong> por SET vinculadas a esas facturas; se excluyen
              anuladas y corregidas por NC); si no hay, suma de{" "}
              <strong style={{ color: Z.text }}>precio de suscripción</strong> con alta o inicio en el período.
            </p>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 px-5 py-4" style={{ backgroundColor: Z.card }}>
            <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: Z.muted }}>
              Clientes nuevos
            </p>
            <p className="mt-2 text-3xl font-bold tabular-nums" style={{ color: Z.text }}>
              {nClientesNuevos}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 px-5 py-4" style={{ backgroundColor: Z.card }}>
            <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: Z.muted }}>
              Valor asociado (Gs.)
            </p>
            <p className="mt-2 text-3xl font-bold tabular-nums" style={{ color: Z.accent }}>
              {formatGsM(totalValorClientesNuevos)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 px-5 py-4" style={{ backgroundColor: Z.card }}>
            <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: Z.muted }}>
              Ticket promedio
            </p>
            <p className="mt-2 text-3xl font-bold tabular-nums" style={{ color: Z.text }}>
              {nClientesNuevos > 0 ? formatGsM(ticketPromedio) : "—"}
            </p>
          </div>
        </div>

        {filasClientesPeriodo.length === 0 ? (
          <p className="mt-8 text-center text-sm" style={{ color: Z.muted }}>
            No hay altas de cliente en este período.
          </p>
        ) : (
          <div
            className="mt-8 max-h-[min(28rem,55vh)] overflow-auto rounded-xl border border-slate-200"
            style={{ backgroundColor: Z.card }}
          >
            <table className="w-full text-sm">
              <thead className="sticky top-0 border-b border-slate-200" style={{ backgroundColor: Z.card }}>
                <tr>
                  {["Cliente", "Alta", "Plan / servicio", "Monto (Gs.)", "Origen valor", "Vendedor"].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wide"
                      style={{ color: Z.muted }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filasClientesPeriodo.map((row) => (
                  <tr key={row.id} className="transition-colors hover:bg-white/[0.04]">
                    <td className="max-w-[160px] truncate px-4 py-3 font-medium" style={{ color: Z.text }} title={row.nombre}>
                      {row.nombre}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs" style={{ color: Z.muted }}>
                      {formatFecha(row.fechaAlta)}
                    </td>
                    <td className="max-w-[140px] truncate px-4 py-3 text-xs" style={{ color: Z.muted }} title={row.planServicio}>
                      {row.planServicio}
                    </td>
                    <td className="px-4 py-3 text-right text-xs font-semibold tabular-nums" style={{ color: Z.text }}>
                      {row.monto > 0 ? formatGs(row.monto) : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: Z.muted }}>
                      {row.fuente === "facturas"
                        ? "Facturas período"
                        : row.fuente === "suscripcion"
                          ? "Suscripción"
                          : "Sin factura / susc. en período"}
                    </td>
                    <td className="max-w-[120px] truncate px-4 py-3 text-xs" style={{ color: Z.muted }} title={row.vendedor}>
                      {row.vendedor}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>
    </div>
  );
});

// ── Dashboard Financiero ──────────────────────────────────────────────────────

/**
 * Monto "Gs. N" · `kpi`: mantiene prefijo y número juntos, tamaño con `cqi` (el padre define `container-type`).
 * Sin kpi: tipografía en clamp por viewport, permite salto.
 */
function FinMontoGs({
  monto,
  className = "text-slate-900",
  negativo,
  dense,
  kpi,
}: {
  monto: number;
  className?: string;
  negativo?: boolean;
  dense?: boolean;
  kpi?: boolean;
}) {
  const texto =
    negativo && monto < 0
      ? `− Gs. ${formatGs(Math.abs(monto))}`
      : `Gs. ${formatGs(monto)}`;
  if (kpi) {
    return (
      <p
        className={`min-w-0 w-full text-left font-bold leading-none tabular-nums whitespace-nowrap [font-size:clamp(0.65rem,5.5cqi+0.15rem,1.45rem)] ${className}`}
        title={texto}
      >
        {texto}
      </p>
    );
  }
  return (
    <p
      className={`${dense ? "mt-1" : "mt-3"} min-w-0 w-full max-w-full break-words whitespace-normal text-left font-bold tabular-nums leading-snug text-[clamp(0.8rem,2.4vw,1.65rem)] sm:text-[clamp(0.85rem,2.2vw,1.75rem)] ${className}`}
      title={texto}
    >
      {texto}
    </p>
  );
}

/**
 * Partición del saldo pendiente por modalidad, facturas con emisión en el rango (Σ saldo por `tipo` factura):
 * - Contado: `tipo` factura = contado
 * - Mensual / suscripción: resto (p. ej. crédito / cuotas vinculadas a suscripción en el producto)
 * Cada factura del período entra en exactamente un bucket (sin doble conteo).
 */
function composicionFacturacionPorModalidad(facturasPeriodo: FacturaRaw[]) {
  let contado = 0;
  let mensual = 0;
  for (const f of facturasPeriodo) {
    const m = Number(f.saldo);
    if (!Number.isFinite(m) || m <= 0) continue;
    const t = (f.tipo ?? "").trim().toLowerCase();
    if (t === "contado") contado += m;
    else mensual += m;
  }
  const total = contado + mensual;
  return {
    contado,
    mensual,
    total,
    pctContado: total > 0 ? (contado / total) * 100 : 0,
    pctMensual: total > 0 ? (mensual / total) * 100 : 0,
  };
}

// memo: el sub-dashboard financiero hace muchos useMemo internos sobre facturas
// y pagos. Sin memo, cualquier render del padre (ej: cambio de tab) los invalidaba.
const DashFinanciero = memo(function DashFinanciero({
  facturas, pagos, clientes, ventas, periodo, config, mapNombreTipoServicio,
}: {
  facturas:  FacturaRaw[];
  pagos:     PagoRaw[];
  clientes:  ClienteRaw[];
  ventas:    VentaRaw[];
  periodo:   Periodo;
  config:    ConfigGlobal;
  mapNombreTipoServicio: Readonly<Record<string, string>>;
}) {
  const { desde, hasta } = useMemo(() => getRango(periodo), [periodo]);

  // Bloque principal: métricas del período (misma ventana que el filtro superior: enRango + fechas calendario)
  const facturasValidas = facturas.filter((f) => !esFacturaAnulada(f.estado));
  const facturasPeriodo = facturasValidas.filter((f) => enRango(f.fecha, desde, hasta));
  const sumSaldoPendiente = (arr: FacturaRaw[]) =>
    arr.reduce((acc, x) => {
      const v = Number(x.saldo);
      return acc + (Number.isFinite(v) ? Math.max(0, v) : 0);
    }, 0);
  const sumMonto = <T extends { monto?: unknown }>(arr: T[]) =>
    arr.reduce((acc, x) => {
      const v = Number(x.monto);
      return acc + (Number.isFinite(v) ? v : 0);
    }, 0);
  const sumMontoEmisionCohort = (arr: FacturaRaw[]) =>
    arr.reduce((acc, x) => {
      const v = Number(x.monto);
      return acc + (Number.isFinite(v) ? v : 0);
    }, 0);

  /**
   * Cohorte fiscal = facturas (fecha emisión en [desde,hasta], no anuladas; mismo filtro de período que abajo).
   * • facturadoCohort: Σ monto = obligación de cobro al emitir.
   * • carteraPendiente: Σ saldo = cartera viva aún a cobrar (misma unidad, ya netea NC/pagos a esas facturas en BD).
   * • recaudadoCohort = facturado − cartera; cumple: facturado = recaudado + pendiente, % = recaudado / facturado.
   *   No mezclar con “caja en el rango” (KPI Cobrado por día / registro de pagos), que puede afectar otras facturas.
   */
  const facturadoCohortPeriodo = sumMontoEmisionCohort(facturasPeriodo);
  const carteraPendienteCohort = sumSaldoPendiente(facturasPeriodo);
  const recaudadoCohortPeriodo = Math.max(0, facturadoCohortPeriodo - carteraPendienteCohort);
  const pctCobranzaCohort =
    facturadoCohortPeriodo > 0 ? (recaudadoCohortPeriodo / facturadoCohortPeriodo) * 100 : null;

  /** Suma de pagos registrados por factura (todas las fechas; para imputar contado sin filas en `pagos`). */
  const montoPagadoPorFacturaId = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pagos) {
      const fid = String(p.factura_id ?? "");
      if (!fid) continue;
      const v = Number(p.monto);
      m.set(fid, (m.get(fid) ?? 0) + (Number.isFinite(v) ? v : 0));
    }
    return m;
  }, [pagos]);

  const facturaEstadoById = useMemo(
    () => Object.fromEntries(facturas.map((f) => [String(f.id), f.estado])),
    [facturas]
  );

  /** Pagos con fecha en el período cuya factura no está anulada. */
  const pagosPeriodo = useMemo(
    () =>
      pagos.filter((p) => {
        if (!enRango(p.fecha_pago, desde, hasta)) return false;
        const est = facturaEstadoById[String(p.factura_id)];
        return !esFacturaAnulada(est);
      }),
    [pagos, desde, hasta, facturaEstadoById]
  );

  /** Cobrado del período = solo pagos registrados (fecha de pago en rango; factura no anulada). */
  const cobradoRegistradoPeriodo = sumMonto(pagosPeriodo);

  /**
   * Facturas al contado emitidas en el período sin filas en `pagos`: cobro contable/operativo implícito al emitir.
   * Métrica separada de “Cobrado del período” (módulo Pagos / tabla pagos).
   */
  const cobroImplicitoContadoPeriodo = useMemo(() => {
    let s = 0;
    for (const f of facturasPeriodo) {
      if ((f.tipo ?? "").toLowerCase() !== "contado") continue;
      if (esFacturaAnulada(f.estado)) continue;
      if (esFacturaCorregidaNc(f.estado)) continue;
      const fid = String(f.id);
      const yaRegistrado = (montoPagadoPorFacturaId.get(fid) ?? 0) > 0;
      if (yaRegistrado) continue;
      const m = Number(f.monto);
      if (Number.isFinite(m) && m > 0) s += m;
    }
    return s;
  }, [facturasPeriodo, montoPagadoPorFacturaId]);

  /** Serie diaria solo con pagos registrados; días sin movimiento en 0 (continuidad del gráfico). */
  const cobradoPorDiaSerie = useMemo(() => {
    const porDia = new Map<string, { monto: number; count: number }>();
    for (const p of pagosPeriodo) {
      const d = toCalendarDateStr(p.fecha_pago);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      const v = Number(p.monto);
      const addM = Number.isFinite(v) ? v : 0;
      const cur = porDia.get(d) ?? { monto: 0, count: 0 };
      cur.monto += addM;
      cur.count += 1;
      porDia.set(d, cur);
    }
    const dias = listarDiasCalendarioYmd(desde, hasta);
    return dias.map((fecha) => {
      const cell = porDia.get(fecha) ?? { monto: 0, count: 0 };
      return {
        fecha,
        monto: cell.monto,
        count: cell.count,
        labelCorta: fecha.slice(8, 10) + "/" + fecha.slice(5, 7),
      };
    });
  }, [pagosPeriodo, desde, hasta]);

  const composicionModalidad = useMemo(
    () => composicionFacturacionPorModalidad(facturasPeriodo),
    [facturasPeriodo]
  );

  /** Prioridad: tipo de servicio → condición de pago → origen */
  const { dimCliente, segmentosClientes } = useMemo(() => {
    const list = clientes;
    const hasServicio = list.some((c) => (c.tipo_servicio_cliente ?? "").trim() !== "");
    const hasCondicion = list.some((c) => (c.condicion_pago ?? "").trim() !== "");
    const dim: "tipo_servicio" | "condicion" | "origen" = hasServicio
      ? "tipo_servicio"
      : hasCondicion
        ? "condicion"
        : "origen";
    const map = new Map<string, number>();
    for (const c of list) {
      let raw = "";
      if (dim === "tipo_servicio") raw = (c.tipo_servicio_cliente ?? "").trim();
      else if (dim === "condicion") raw = (c.condicion_pago ?? "").trim();
      else raw = (c.origen ?? "").trim();
      const key = raw || "__sin__";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    const PALETTE = ["#2563EB", "#3B82F6", "#60A5FA", "#22C55E", "#A78BFA", "#F59E0B", "#EC4899", "#38BDF8"];
    const entries = [...map.entries()].sort((a, b) => b[1] - a[1]);
    return {
      dimCliente: dim,
      segmentosClientes: entries.map(([k, count], i) => ({
        label:
          k === "__sin__"
            ? "Sin clasificar"
            : dim === "tipo_servicio"
              ? etiquetaVisibleTipoServicio(k, mapNombreTipoServicio)
              : labelClienteDimension(k),
        value: count,
        color: PALETTE[i % PALETTE.length],
      })),
    };
  }, [clientes, mapNombreTipoServicio]);

  /**
   * Deuda por `tipo_servicio_cliente` (catálogo): facturas de la coorte (emisión en rango) con saldo > 0
   * saldo de factura (cartera viva), asignada al segmento del cliente; Sin clasificar si no hay.
   */
  const deudaPorTipoServicio = useMemo(() => {
    const m = new Map<string, number>();
    const byCliente = new Map<string, string>();
    for (const c of clientes) {
      const raw = (c.tipo_servicio_cliente ?? "").trim();
      byCliente.set(String(c.id), raw ? raw.toLowerCase() : "__sin__");
    }
    for (const f of facturasPeriodo) {
      if (esFacturaAnulada(f.estado)) continue;
      const s = Number(f.saldo);
      if (!Number.isFinite(s) || s <= 0) continue;
      const slug = byCliente.get(String(f.cliente_id)) ?? "__sin__";
      m.set(slug, (m.get(slug) ?? 0) + s);
    }
    const pal = ["#2563EB", "#3B82F6", "#60A5FA", "#22C55E", "#A78BFA", "#F59E0B", "#EC4899", "#38BDF8"];
    const list = [...m.entries()]
      .map(([k, v]) => ({
        key: k,
        value: v,
        label: k === "__sin__" ? "Sin clasificar" : etiquetaVisibleTipoServicio(k, mapNombreTipoServicio),
      }))
      .sort((a, b) => b.value - a.value)
      .map((row, i) => ({ ...row, color: pal[i % pal.length] }));
    return {
      list,
      total: list.reduce((a, b) => a + b.value, 0),
    };
  }, [clientes, facturasPeriodo, mapNombreTipoServicio]);

  const facturaById = useMemo(
    () => new Map(facturas.map((f) => [String(f.id), f] as const)),
    [facturas]
  );

  /**
   * Suma monto de `pagos` con `fecha_pago` en [desde,hasta] (mismo conjunto que “Cobrado por día”;
   * excluye factura anulada) agrupada por el tipo de servicio del **cliente** (slug → catálogo).
   */
  const cobradoPorTipoServicio = useMemo(() => {
    const m = new Map<string, number>();
    const byCliente = new Map<string, string>();
    for (const c of clientes) {
      const raw = (c.tipo_servicio_cliente ?? "").trim();
      byCliente.set(String(c.id), raw ? raw.toLowerCase() : "__sin__");
    }
    for (const p of pagosPeriodo) {
      const factura = facturaById.get(String(p.factura_id));
      if (!factura) continue;
      const pagoMonto = Number(p.monto);
      if (!Number.isFinite(pagoMonto) || pagoMonto <= 0) continue;
      const slug = byCliente.get(String(factura.cliente_id)) ?? "__sin__";
      m.set(slug, (m.get(slug) ?? 0) + pagoMonto);
    }
    const pal = ["#2563EB", "#3B82F6", "#60A5FA", "#22C55E", "#A78BFA", "#F59E0B", "#EC4899", "#38BDF8"];
    const list = [...m.entries()]
      .map(([k, v]) => ({
        key: k,
        value: v,
        label: k === "__sin__" ? "Sin clasificar" : etiquetaVisibleTipoServicio(k, mapNombreTipoServicio),
      }))
      .sort((a, b) => b.value - a.value)
      .map((row, i) => ({ ...row, color: pal[i % pal.length] }));
    return {
      list,
      total: list.reduce((a, b) => a + b.value, 0),
    };
  }, [clientes, pagosPeriodo, facturaById, mapNombreTipoServicio]);

  const deudaMaxTipo = deudaPorTipoServicio.list.length
    ? Math.max(...deudaPorTipoServicio.list.map((r) => r.value), 0)
    : 1;

  const cobradoMaxTipo = cobradoPorTipoServicio.list.length
    ? Math.max(...cobradoPorTipoServicio.list.map((r) => r.value), 0)
    : 1;

  const finCard =
    "min-w-0 overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-6 shadow-sm shadow-slate-200/50 transition-shadow hover:shadow-md sm:p-7";
  /** Caja de consulta (inline-size) para `cqi`; alinea al fondo y estira con la card. */
  const finKpiValueWrap =
    "flex min-h-0 w-full min-w-0 flex-1 [container-type:inline-size] items-end";
  const finKpiCard = `${finCard} flex h-full min-h-[9.5rem] flex-col`;
  const finAccent = "#2563EB";

  return (
    <div className="space-y-6 rounded-2xl border border-slate-200/80 bg-gradient-to-b from-slate-50 to-white p-4 sm:space-y-8 sm:p-6 md:p-8">
      <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:gap-5">
        <motion.div whileHover={{ y: -2 }} className={finKpiCard}>
          <p className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Facturado del período</p>
          <div className={finKpiValueWrap}>
            <FinMontoGs kpi monto={facturadoCohortPeriodo} />
          </div>
        </motion.div>
        <motion.div whileHover={{ y: -2 }} className={finKpiCard}>
          <p className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Cobrado del período</p>
          <div className={finKpiValueWrap}>
            <FinMontoGs kpi monto={recaudadoCohortPeriodo} className="text-[#2563EB]" />
          </div>
        </motion.div>
        <motion.div whileHover={{ y: -2 }} className={finKpiCard}>
          <p className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Pendiente del período</p>
          <div className={finKpiValueWrap}>
            <FinMontoGs
              kpi
              monto={carteraPendienteCohort}
              negativo={carteraPendienteCohort < 0}
              className={
                carteraPendienteCohort > 0
                  ? "text-amber-600"
                  : carteraPendienteCohort < 0
                    ? "text-emerald-600"
                    : "text-slate-900"
              }
            />
          </div>
        </motion.div>
        <motion.div whileHover={{ y: -2 }} className={finKpiCard}>
          <p className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500">% de cobranza</p>
          <div className={finKpiValueWrap}>
            <p
              className="min-w-0 w-full text-left font-bold tabular-nums leading-none text-slate-900 whitespace-nowrap [font-size:clamp(0.7rem,5.5cqi+0.15rem,1.5rem)]"
              title={pctCobranzaCohort == null ? "—" : `${pctCobranzaCohort.toFixed(1)}%`}
            >
              {pctCobranzaCohort == null ? "—" : `${pctCobranzaCohort.toFixed(1)}%`}
            </p>
          </div>
        </motion.div>
      </div>

      <div className={finCard}>
        <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Cobrado por día</h3>
            <p className="mt-1 text-[11px] text-slate-400">Pagos registrados por fecha de pago</p>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5 sm:items-end sm:text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Total cobrado</p>
            <FinMontoGs monto={cobradoRegistradoPeriodo} dense className="text-[#2563EB]" />
          </div>
        </div>
        {cobradoPorDiaSerie.length === 0 ? (
          <p className="mt-6 text-sm text-slate-500">Sin rango de fechas válido.</p>
        ) : (
          <div className="mt-5 h-[300px] w-full min-w-0">
            <ChartCobradoPorDia
              data={cobradoPorDiaSerie}
              accentColor={finAccent}
              formatGs={formatGs}
              formatGsM={formatGsM}
              formatFecha={formatFecha}
            />
          </div>
        )}
      </div>

      <div className={finCard}>
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Composición del período</h3>
        <p className="mt-1 text-[11px] text-slate-400">Facturación emitida por tipo de factura</p>
        <div className="mt-5 flex h-4 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200/70">
          {composicionModalidad.total > 0 ? (
            <>
              <div
                className="h-full bg-[#2563EB] transition-[width] duration-300"
                style={{ width: `${composicionModalidad.pctContado}%`, minWidth: composicionModalidad.contado > 0 ? 4 : 0 }}
                title={`Contado ${composicionModalidad.pctContado.toFixed(1)}%`}
              />
              <div
                className="h-full bg-slate-500 transition-[width] duration-300"
                style={{ width: `${composicionModalidad.pctMensual}%`, minWidth: composicionModalidad.mensual > 0 ? 4 : 0 }}
                title={`Mensual / suscripción ${composicionModalidad.pctMensual.toFixed(1)}%`}
              />
            </>
          ) : null}
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-100 bg-slate-50/90 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Contado</p>
            <FinMontoGs monto={composicionModalidad.contado} dense className="text-slate-900" />
            <p className="mt-1 text-sm font-semibold tabular-nums text-slate-500">
              {composicionModalidad.total > 0 ? `${composicionModalidad.pctContado.toFixed(1)}%` : "—"}
            </p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/90 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Mensual / suscripción</p>
            <FinMontoGs monto={composicionModalidad.mensual} dense className="text-slate-900" />
            <p className="mt-1 text-sm font-semibold tabular-nums text-slate-500">
              {composicionModalidad.total > 0 ? `${composicionModalidad.pctMensual.toFixed(1)}%` : "—"}
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-1 border-t border-slate-100 pt-4 sm:flex-row sm:items-baseline sm:justify-between">
          <span className="text-xs font-semibold text-slate-500">Total emitido</span>
          <div className="min-w-0 sm:text-right">
            <FinMontoGs monto={composicionModalidad.total} dense className="text-slate-900" />
          </div>
        </div>
        <p className="mt-3 text-[10px] leading-snug text-slate-400">
          Emisión en el período, sin anuladas · contado vs resto por tipo · sin pagos ni doble conteo.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        <div className={finCard}>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Deuda por tipo de cliente</h3>
          <p className="mt-1 text-[11px] text-slate-400">
            Σ <span className="font-medium text-slate-500">saldo</span> de facturas emitidas en el rango, por{" "}
            <span className="font-medium text-slate-500">clientes.tipo_servicio_cliente</span> (nombre desde catálogo
            CRM).
          </p>
          {deudaPorTipoServicio.list.length === 0 ? (
            <p className="mt-6 text-sm text-slate-500">No hay deuda pendiente (saldo &gt; 0) en el período o sin segmentos con saldo.</p>
          ) : (
            <div className="mt-6 space-y-4">
              {deudaPorTipoServicio.list.map((row) => (
                <div key={row.key}>
                  <div className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 break-words font-medium text-slate-700" title={row.label}>
                      <span
                        className="mr-2 inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: row.color }}
                      />
                      {row.label}
                    </span>
                    <span className="shrink-0 text-right text-sm font-bold tabular-nums text-slate-900">
                      Gs. {formatGs(row.value)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full min-w-0 rounded-full"
                      style={{
                        width: `${deudaMaxTipo > 0 ? (row.value / deudaMaxTipo) * 100 : 0}%`,
                        backgroundColor: row.color,
                      }}
                      title={row.label}
                    />
                  </div>
                </div>
              ))}
              <div className="flex min-w-0 items-baseline justify-between gap-2 border-t border-slate-100 pt-4 text-sm">
                <span className="font-semibold text-slate-600">Total deuda (vista)</span>
                <span className="shrink-0 text-right text-base font-bold tabular-nums text-slate-900">
                  Gs. {formatGs(deudaPorTipoServicio.total)}
                </span>
              </div>
            </div>
          )}
        </div>
        <div className={finCard}>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Cobrado por tipo de cliente</h3>
          <p className="mt-1 text-[11px] text-slate-400">
            Σ <span className="font-medium text-slate-500">monto de pagos</span> con fecha de pago en el rango (misma
            lógica que <span className="font-medium text-slate-500">Cobrado por día</span> / factura no anulada),
            asignado al <span className="font-medium text-slate-500">cliente</span> vía{" "}
            <span className="font-medium text-slate-500">tipo_servicio_cliente</span> (nombre catálogo CRM). No
            incluye contado sin fila de pago.
          </p>
          {cobradoPorTipoServicio.list.length === 0 ? (
            <p className="mt-6 text-sm text-slate-500">No hay pagos en el período con factura vinculada a cliente.</p>
          ) : (
            <div className="mt-6 space-y-4">
              {cobradoPorTipoServicio.list.map((row) => (
                <div key={row.key}>
                  <div className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 break-words font-medium text-slate-700" title={row.label}>
                      <span
                        className="mr-2 inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: row.color }}
                      />
                      {row.label}
                    </span>
                    <span className="shrink-0 text-right text-sm font-bold tabular-nums text-slate-900">
                      Gs. {formatGs(row.value)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full min-w-0 rounded-full"
                      style={{
                        width: `${cobradoMaxTipo > 0 ? (row.value / cobradoMaxTipo) * 100 : 0}%`,
                        backgroundColor: row.color,
                      }}
                      title={row.label}
                    />
                  </div>
                </div>
              ))}
              <div className="flex min-w-0 items-baseline justify-between gap-2 border-t border-slate-100 pt-4 text-sm">
                <span className="font-semibold text-slate-600">Total cobrado (vista)</span>
                <span className="shrink-0 text-right text-base font-bold tabular-nums text-slate-900">
                  Gs. {formatGs(cobradoPorTipoServicio.total)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5 lg:gap-8">
        <motion.div whileHover={{ y: -2 }} className={`${finCard} lg:col-span-3`}>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Progreso de metas</h3>
          <div className="mt-6 grid grid-cols-1 gap-8">
            <ProgressBar
              variant="light"
              label="Ventas mensuales"
              value={ventas
                .filter((v) => enMesCalendarioActual(toCalendarDateStr(v.fecha)))
                .reduce((s, v) => {
                  const t = Number(v.total);
                  return s + (Number.isFinite(t) ? t : 0);
                }, 0)}
              meta={config.meta_ventas_mensuales}
              format="gs"
            />
          </div>
        </motion.div>
        <motion.div whileHover={{ y: -2 }} className={`${finCard} lg:col-span-2`}>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Distribución de clientes</h3>
          <p className="mt-1 text-[11px] text-slate-400">
            Por{" "}
            {dimCliente === "tipo_servicio"
              ? "tipo de servicio"
              : dimCliente === "condicion"
                ? "condición de pago"
                : "origen"}
            .
          </p>
          <div className="mt-6">
            <DonutChart
              variant="light"
              legendDetail
              segments={segmentosClientes}
              centerLabel="clientes"
              formatValue={(v) => String(v)}
            />
          </div>
        </motion.div>
      </div>
    </div>
  );
});

// ── Dashboard Inventario ─────────────────────────────────────────────────────

// memo: dashboard de inventario hace filter/reduce sobre productos en cada render.
// Sin memo, cualquier cambio en el padre re-ejecutaba esos calculos.
const DashInventario = memo(function DashInventario({
  productos,
  compras,
}: {
  productos: ProductoRaw[];
  compras:   CompraRaw[];
}) {
  const totalProductos = productos.length;
  const totalUnidades  = productos.reduce((s, p) => s + p.stock_actual, 0);
  const bajosStock     = productos.filter(p => p.stock_actual <= p.stock_minimo).length;
  const valorTotal     = productos.reduce((s, p) => s + p.stock_actual * p.costo_promedio, 0);

  const cntSaludable = productos.filter(p => p.stock_actual > p.stock_minimo).length;
  const cntBajo      = productos.filter(p => p.stock_actual > 0 && p.stock_actual <= p.stock_minimo).length;
  const cntCritico   = productos.filter(p => p.stock_actual <= 0).length;

  const proveedorMap = useMemo(() => {
    const map: Record<string, string> = {};
    compras.forEach(c => { if (c.producto_id) map[String(c.producto_id)] = c.proveedor_nombre; });
    return map;
  }, [compras]);

  const criticos = useMemo(() =>
    productos
      .filter(p => p.stock_actual <= p.stock_minimo)
      .sort((a, b) => a.stock_actual - b.stock_actual)
      .slice(0, 10),
    [productos]
  );

  const topPorValor = useMemo(() =>
    [...productos]
      .map(p => ({ ...p, valor: p.stock_actual * p.costo_promedio }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 8),
    [productos]
  );

  return (
    <div className="space-y-5">

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={Package} label="Productos totales"      value={String(totalProductos)} color="text-[#3F8E91]" variation={4} />
        <KpiCard icon={Hash} label="Stock total (unidades)" value={formatGs(totalUnidades)} color="text-[#3F8E91]" />
        <KpiCard icon={AlertTriangle} label="Bajo stock mínimo"      value={String(bajosStock)}
          sub={bajosStock > 0 ? "requieren reposición" : "todo en orden"}
          color={bajosStock > 0 ? "text-red-600" : "text-[#3F8E91]"}
          variation={bajosStock > 0 ? -2 : undefined} />
        <KpiCard icon={Gem} label="Valor del inventario"   value={`Gs. ${formatGsFull(valorTotal)}`} color="text-[#3F8E91]" variation={12} />
      </div>

      {/* Donut + Críticos */}
      <div className="grid grid-cols-3 gap-4">
        <motion.div whileHover={{ y: -2 }} className="rounded-2xl border border-[#4FAEB2]/30 bg-white p-6 shadow-sm ring-1 ring-[#4FAEB2]/10 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
          <h3 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700">
            <span className="inline-block h-3.5 w-1 rounded-full bg-[#4FAEB2]" />
            Estado del stock
          </h3>
          <DonutChart segments={[
            { label: "Saludable", value: cntSaludable, color: "#22c55e" },
            { label: "Bajo",      value: cntBajo,      color: "#f59e0b" },
            { label: "Crítico",   value: cntCritico,   color: "#ef4444" },
          ]} centerLabel="productos" />
        </motion.div>
        <motion.div whileHover={{ y: -2 }} className="col-span-2 rounded-2xl border border-[#4FAEB2]/30 bg-white p-6 shadow-sm ring-1 ring-[#4FAEB2]/10 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
          <h3 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700">
            <span className="inline-block h-3.5 w-1 rounded-full bg-[#4FAEB2]" />
            Productos críticos — stock bajo mínimo
          </h3>
          {criticos.length === 0 ? (
            <div className="flex items-center gap-2 text-[var(--badge-success-text)] bg-[var(--badge-success-bg)] rounded-lg px-4 py-3 text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" strokeWidth={2} /> Todos los productos tienen stock suficiente.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-[#E5F4F4] border-b-2 border-[#4FAEB2]/40">
                  <tr>
                    <th className="w-10 px-3 py-3">
                      <input type="checkbox" className="h-4 w-4 rounded border-slate-300 accent-[#4FAEB2]" />
                    </th>
                    {["Producto", "Stock actual", "Stock mín.", "Estado", "Proveedor"].map(h => (
                      <th key={h} className="text-left text-xs font-bold text-[#3F8E91] px-3 py-3 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {criticos.map(p => (
                    <tr key={p.id} className={`${p.stock_actual <= 0 ? "bg-red-50/50" : "bg-amber-50/40"} transition-colors hover:bg-[#4FAEB2]/10`}>
                      <td className="px-3 py-2.5">
                        <input type="checkbox" className="h-4 w-4 rounded border-slate-300 accent-[#4FAEB2]" />
                      </td>
                      <td className="px-3 py-2.5 text-xs font-semibold text-slate-900">{p.nombre}</td>
                      <td className="px-3 py-2.5">
                        <span className={`text-xs font-bold tabular-nums ${p.stock_actual <= 0 ? "text-red-600" : "text-amber-600"}`}>
                          {p.stock_actual} {p.unidad_medida}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs font-medium text-slate-600 tabular-nums">{p.stock_minimo} {p.unidad_medida}</td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                          p.stock_actual <= 0 ? "bg-[var(--badge-error-bg)] text-[var(--badge-error-text)]" : "bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]"
                        }`}>
                          {p.stock_actual <= 0 ? "Crítico" : "Bajo"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs font-medium text-slate-600">{proveedorMap[String(p.id)] ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      </div>

      {/* Top por valor */}
      <motion.div whileHover={{ y: -2 }} className="rounded-2xl border border-[#4FAEB2]/30 bg-white p-6 shadow-sm ring-1 ring-[#4FAEB2]/10 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
        <h3 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700">
          <span className="inline-block h-3.5 w-1 rounded-full bg-[#4FAEB2]" />
          Top productos por valor de inventario
        </h3>
        {topPorValor.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6">Sin productos registrados.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-[#E5F4F4] border-b-2 border-[#4FAEB2]/40">
                <tr>
                  <th className="w-10 px-3 py-3">
                    <input type="checkbox" className="h-4 w-4 rounded border-slate-300 accent-[#4FAEB2]" />
                  </th>
                  {["Producto", "SKU", "Stock", "Costo promedio", "Valor inventario"].map(h => (
                    <th key={h} className="text-left text-xs font-bold text-[#3F8E91] px-3 py-3 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {topPorValor.map(p => (
                  <tr key={p.id} className="transition-colors hover:bg-[#4FAEB2]/10">
                    <td className="px-3 py-2.5">
                      <input type="checkbox" className="h-4 w-4 rounded border-slate-300 accent-[#4FAEB2]" />
                    </td>
                    <td className="px-3 py-2.5 text-xs font-semibold text-slate-900">{p.nombre}</td>
                    <td className="px-3 py-2.5 font-mono text-xs font-medium text-[#3F8E91]">{p.sku}</td>
                    <td className="px-3 py-2.5 text-xs tabular-nums font-medium text-slate-700">{p.stock_actual}</td>
                    <td className="px-3 py-2.5 text-xs tabular-nums text-slate-600">Gs. {formatGs(p.costo_promedio)}</td>
                    <td className="px-3 py-2.5 text-xs tabular-nums font-bold text-slate-900">Gs. {formatGs(p.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>

    </div>
  );
});

// ── Dashboard Ventas ──────────────────────────────────────────────────────────

// memo: ventas + productos pueden ser arrays grandes; los filter/reduce internos
// solo se cachean si no re-renderea el componente entero.
const DashVentas = memo(function DashVentas({
  ventas,
  productos,
  periodo,
}: {
  ventas:    VentaRaw[];
  productos: ProductoRaw[];
  periodo:   Periodo;
}) {
  const { desde, hasta } = useMemo(() => getRango(periodo), [periodo]);

  const ventasFilt = useMemo(() =>
    ventas.filter(v => enRango(v.fecha, desde, hasta)),
    [ventas, desde, hasta]
  );

  const ventasHoy = useMemo(() => {
    const { desde: d, hasta: h } = getRango("hoy");
    return ventas.filter(v => enRango(v.fecha, d, h));
  }, [ventas]);

  const ventasMes = useMemo(() => {
    const { desde: d, hasta: h } = getRango("mes");
    return ventas.filter(v => enRango(v.fecha, d, h));
  }, [ventas]);

  const totalHoy   = ventasHoy.reduce((s, v) => s + v.total, 0);
  const totalMes   = ventasMes.reduce((s, v) => s + v.total, 0);
  const ticketProm = ventasFilt.length > 0 ? ventasFilt.reduce((s, v) => s + v.total, 0) / ventasFilt.length : 0;
  const unidades   = ventasFilt.flatMap(v => v.lineas ?? []).reduce((s, l) => s + (l?.cantidad ?? 0), 0);

  const prodMap = useMemo(() =>
    Object.fromEntries(productos.map(p => [p.id, p])),
    [productos]
  );

  const gananciaHoy = useMemo(() =>
    ventasHoy.flatMap(v => v.lineas ?? []).reduce((s, l) => {
      if (!l) return s;
      const costo = prodMap[l.producto_id]?.costo_promedio ?? 0;
      return s + (l.precio_venta - costo) * l.cantidad;
    }, 0),
    [ventasHoy, prodMap]
  );

  const totalHoyBruto = ventasHoy.flatMap(v => v.lineas ?? [])
    .reduce((s, l) => s + (l ? l.precio_venta * l.cantidad : 0), 0);

  const margenProm = totalHoyBruto > 0 ? (gananciaHoy / totalHoyBruto) * 100 : 0;

  const topProductos = useMemo(() => {
    const map: Record<string, number> = {};
    ventasFilt.flatMap(v => v.lineas ?? []).filter(Boolean).forEach(l => {
      map[l.producto_nombre] = (map[l.producto_nombre] ?? 0) + l.cantidad;
    });
    return Object.entries(map)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [ventasFilt]);

  const ventasPorHora = useMemo(() => {
    const horas = Array.from({ length: 24 }, (_, h) => ({
      label: `${String(h).padStart(2, "0")}h`,
      value: 0,
    }));
    ventasHoy.forEach(v => {
      const h = new Date(v.fecha).getHours();
      if (h >= 0 && h < 24) horas[h].value += v.total;
    });
    const ahora = new Date().getHours();
    return horas.slice(0, ahora + 1);
  }, [ventasHoy]);

  const desglose = useMemo(() => {
    const tipos = ["CONTADO", "CREDITO"] as const;
    return tipos.map(tipo => {
      const lst = ventasFilt.filter(v => v.tipo_venta === tipo);
      const total = lst.reduce((s, v) => s + v.total, 0);
      const unid  = lst.flatMap(v => v.lineas ?? []).reduce((s, l) => s + (l?.cantidad ?? 0), 0);
      return { tipo, ventas: lst.length, total, ticket: lst.length ? total / lst.length : 0, unid };
    });
  }, [ventasFilt]);

  return (
    <div className="space-y-5">

      {/* KPIs principales */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={Calendar} label="Ventas del día"    value={`Gs. ${formatGsFull(totalHoy)}`}
          sub={`${ventasHoy.length} transacciones`} color="text-blue-600" />
        <KpiCard icon={CalendarDays} label="Ventas del mes"    value={`Gs. ${formatGsFull(totalMes)}`}
          sub={`${ventasMes.length} transacciones`} color="text-indigo-600" />
        <KpiCard icon={Receipt} label="Ticket promedio"   value={`Gs. ${formatGsFull(ticketProm)}`}
          sub={`periodo: ${periodo}`} />
        <KpiCard icon={Boxes} label="Unidades vendidas" value={formatGs(unidades)}
          sub={`en el periodo`} />
      </div>

      {/* KPIs rentabilidad */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
            <DollarSign className="h-5 w-5" strokeWidth={2} />
          </div>
          <div>
            <p className={`text-2xl font-bold tabular-nums ${gananciaHoy >= 0 ? "text-green-600" : "text-red-600"}`}>
              Gs. {formatGsFull(gananciaHoy)}
            </p>
            <p className="text-xs font-semibold text-gray-700 mt-0.5">Ganancia del día</p>
            <p className="text-xs text-gray-400">precio venta − costo promedio × cant.</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700">
            <BarChart3 className="h-5 w-5" strokeWidth={2} />
          </div>
          <div>
            <p className={`text-2xl font-bold tabular-nums ${margenProm >= 20 ? "text-green-600" : margenProm >= 10 ? "text-amber-600" : "text-red-600"}`}>
              {margenProm.toFixed(1)}%
            </p>
            <p className="text-xs font-semibold text-gray-700 mt-0.5">Margen promedio (hoy)</p>
            <p className="text-xs text-gray-400">ganancia / precio venta</p>
          </div>
        </div>
      </div>

      {/* Productos más vendidos + Ventas por hora */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">
            Productos más vendidos
          </h3>
          {topProductos.length === 0
            ? <p className="text-sm text-gray-400 text-center py-6">Sin ventas en el periodo.</p>
            : <HBarChart data={topProductos} color="bg-indigo-400" />
          }
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">
            Ventas por hora — hoy
          </h3>
          {ventasPorHora.every(h => h.value === 0)
            ? <p className="text-sm text-gray-400 text-center py-6">Sin ventas registradas hoy.</p>
            : <AreaChart data={ventasPorHora} color="#10b981" />
          }
        </div>
      </div>

      {/* Desglose por tipo */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">
          Desglose por tipo de venta
        </h3>
        {ventasFilt.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">Sin ventas en el periodo seleccionado.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {["Tipo", "Cantidad", "Total", "Ticket promedio", "Unidades"].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-500 px-3 py-2.5 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {desglose.map(r => (
                <tr key={r.tipo} className="hover:bg-gray-50/60 transition-colors">
                  <td className="px-3 py-2.5">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${r.tipo === "CONTADO" ? "bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]" : "bg-[#E0F2FE] text-[#0284C7]"}`}>
                      {r.tipo}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs tabular-nums text-gray-700">{r.ventas}</td>
                  <td className="px-3 py-2.5 text-xs tabular-nums font-semibold text-gray-800">Gs. {formatGs(r.total)}</td>
                  <td className="px-3 py-2.5 text-xs tabular-nums text-gray-500">Gs. {formatGs(Math.round(r.ticket))}</td>
                  <td className="px-3 py-2.5 text-xs tabular-nums text-gray-500">{r.unid}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

    </div>
  );
});

// ── Dashboard Compras ─────────────────────────────────────────────────────────

const DashCompras = memo(function DashCompras({
  compras,
  periodo,
}: {
  compras: CompraRaw[];
  periodo: Periodo;
}) {
  const { desde: desdeD, hasta: hastaD } = getRango(periodo);
  const desde = desdeD.toISOString().slice(0, 10);
  const hasta = hastaD.toISOString().slice(0, 10);

  // Agrupamos por numero_control (una "compra" real = N líneas con mismo N° control).
  type Grupo = {
    numero_control: string;
    proveedor_nombre: string;
    total: number;
    fecha: string;
    tipo_pago: string | null;
    plazo_dias: number | null;
    vencimientoDate: Date | null;
    diasHastaVence: number | null;
  };
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const gruposMap = new Map<string, Grupo>();
  for (const c of compras) {
    const key = c.numero_control || String(c.id);
    const g = gruposMap.get(key);
    if (!g) {
      let vencimientoDate: Date | null = null;
      let diasHastaVence: number | null = null;
      if (c.tipo_pago === "credito" && c.plazo_dias && c.fecha) {
        const base = new Date(c.fecha);
        base.setDate(base.getDate() + Number(c.plazo_dias));
        base.setHours(0, 0, 0, 0);
        vencimientoDate = base;
        diasHastaVence = Math.round((base.getTime() - hoy.getTime()) / 86400000);
      }
      gruposMap.set(key, {
        numero_control: key,
        proveedor_nombre: c.proveedor_nombre,
        total: Number(c.total) || 0,
        fecha: c.fecha,
        tipo_pago: c.tipo_pago ?? null,
        plazo_dias: c.plazo_dias ?? null,
        vencimientoDate,
        diasHastaVence,
      });
    } else {
      g.total += Number(c.total) || 0;
    }
  }
  const grupos = [...gruposMap.values()];

  // Del período (para "compras del período")
  const gruposPeriodo = grupos.filter((g) => g.fecha >= desde && g.fecha <= hasta);
  const totalPeriodo = gruposPeriodo.reduce((s, g) => s + g.total, 0);

  // Deuda con proveedores = compras crédito no vencidas ni anuladas (ya excluidas)
  const conCredito = grupos.filter((g) => g.tipo_pago === "credito" && g.vencimientoDate);
  const deudaTotal = conCredito.reduce((s, g) => s + g.total, 0);
  const porVencer = conCredito
    .filter((g) => (g.diasHastaVence ?? 0) >= 0 && (g.diasHastaVence ?? 0) <= 30)
    .sort((a, b) => (a.diasHastaVence ?? 0) - (b.diasHastaVence ?? 0));
  const vencidas = conCredito
    .filter((g) => (g.diasHastaVence ?? 0) < 0)
    .sort((a, b) => (a.diasHastaVence ?? 0) - (b.diasHastaVence ?? 0));

  const totalPorVencer = porVencer.reduce((s, g) => s + g.total, 0);
  const totalVencidas = vencidas.reduce((s, g) => s + g.total, 0);

  // Top proveedores (por gasto del período)
  const porProveedor = new Map<string, number>();
  for (const g of gruposPeriodo) {
    porProveedor.set(g.proveedor_nombre, (porProveedor.get(g.proveedor_nombre) ?? 0) + g.total);
  }
  const topProveedores = [...porProveedor.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const finCard = "rounded-2xl border border-slate-200 bg-white p-6 shadow-sm";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatBox label="Compras del período" value={`Gs. ${Math.round(totalPeriodo).toLocaleString("es-PY")}`} sub={`${gruposPeriodo.length} compras`} />
        <StatBox label="Deuda con proveedores" value={`Gs. ${Math.round(deudaTotal).toLocaleString("es-PY")}`} sub={`${conCredito.length} facturas`} />
        <StatBox label="Por vencer (30 días)" value={`Gs. ${Math.round(totalPorVencer).toLocaleString("es-PY")}`} sub={`${porVencer.length} facturas`} tone="warn" />
        <StatBox label="Vencidas" value={`Gs. ${Math.round(totalVencidas).toLocaleString("es-PY")}`} sub={`${vencidas.length} facturas`} tone="danger" />
      </div>

      <div className={finCard}>
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Próximas a vencer</h3>
        {porVencer.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">No hay compras a crédito por vencer en los próximos 30 días.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-slate-200">
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="pb-2 pr-4">N° Control</th>
                  <th className="pb-2 pr-4">Proveedor</th>
                  <th className="pb-2 pr-4 text-right">Total</th>
                  <th className="pb-2 pr-4 text-center">Vence</th>
                  <th className="pb-2 text-center">Días</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {porVencer.slice(0, 20).map((g) => {
                  const dias = g.diasHastaVence ?? 0;
                  const tone = dias <= 3 ? "text-red-600" : dias <= 7 ? "text-orange-600" : "text-slate-600";
                  return (
                    <tr key={g.numero_control} className="hover:bg-slate-50/50">
                      <td className="py-2 pr-4 font-mono text-xs text-slate-500">{g.numero_control}</td>
                      <td className="py-2 pr-4 text-slate-800">{g.proveedor_nombre}</td>
                      <td className="py-2 pr-4 text-right tabular-nums font-semibold text-slate-800">Gs. {Math.round(g.total).toLocaleString("es-PY")}</td>
                      <td className="py-2 pr-4 text-center text-xs text-slate-500">{g.vencimientoDate?.toLocaleDateString("es-PY")}</td>
                      <td className={`py-2 text-center text-xs font-semibold ${tone}`}>{dias} días</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {vencidas.length > 0 && (
        <div className={`${finCard} border-red-200 bg-red-50/40`}>
          <h3 className="text-xs font-bold uppercase tracking-wider text-red-700">Vencidas · pagar urgente</h3>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-red-200">
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-red-700">
                  <th className="pb-2 pr-4">N° Control</th>
                  <th className="pb-2 pr-4">Proveedor</th>
                  <th className="pb-2 pr-4 text-right">Total</th>
                  <th className="pb-2 pr-4 text-center">Vencía</th>
                  <th className="pb-2 text-center">Atraso</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-red-100">
                {vencidas.slice(0, 20).map((g) => (
                  <tr key={g.numero_control} className="hover:bg-red-50">
                    <td className="py-2 pr-4 font-mono text-xs text-red-700">{g.numero_control}</td>
                    <td className="py-2 pr-4 text-red-800">{g.proveedor_nombre}</td>
                    <td className="py-2 pr-4 text-right tabular-nums font-bold text-red-800">Gs. {Math.round(g.total).toLocaleString("es-PY")}</td>
                    <td className="py-2 pr-4 text-center text-xs text-red-600">{g.vencimientoDate?.toLocaleDateString("es-PY")}</td>
                    <td className="py-2 text-center text-xs font-bold text-red-700">{Math.abs(g.diasHastaVence ?? 0)} días</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className={finCard}>
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Top proveedores del período</h3>
        {topProveedores.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">Sin compras en el período seleccionado.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {topProveedores.map(([nombre, monto]) => {
              const pct = totalPeriodo > 0 ? (monto / totalPeriodo) * 100 : 0;
              return (
                <li key={nombre}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-800">{nombre}</span>
                    <span className="tabular-nums font-semibold text-slate-700">Gs. {Math.round(monto).toLocaleString("es-PY")}</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-[#4FAEB2]" style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
});

function StatBox({ label, value, sub, tone = "default" }: { label: string; value: string; sub?: string; tone?: "default" | "warn" | "danger" }) {
  const toneClass =
    tone === "danger" ? "border-red-200 bg-red-50/40 text-red-700" :
    tone === "warn" ? "border-amber-200 bg-amber-50/50 text-amber-700" :
    "border-slate-200 bg-white text-slate-800";
  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${toneClass}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider opacity-75">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] opacity-70">{sub}</p>}
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────

const PERIODO_OPTS: { id: Periodo; label: string }[] = [
  { id: "hoy",  label: "Hoy"       },
  { id: "7d",   label: "7 días"    },
  { id: "30d",  label: "30 días"   },
  { id: "mes",  label: "Mes actual"},
  { id: "anio", label: "Año"       },
];

const TAB_VALID: TabDash[] = ["comercial", "financiero", "inventario", "ventas", "compras"];

type DashScope =
  | { kind: "pending" }
  | { kind: "legacy" }
  | { kind: "empty" }
  | { kind: "scoped"; tabs: TabDash[]; defaultTab: TabDash };

function getInitialTab(): TabDash {
  if (typeof window === "undefined") return "ventas";
  const params = new URLSearchParams(window.location.search);
  const t = params.get("tab");
  return t && isDashboardTabSlug(t) ? t : "ventas";
}

export default function DashboardPage() {
  const [dashScope, setDashScope] = useState<DashScope>({ kind: "pending" });
  const [tab,      setTab]      = useState<TabDash>(getInitialTab);
  const [periodo,  setPeriodo]  = useState<Periodo>("mes");
  const [config,   setConfig]   = useState<ConfigGlobal | null>(null);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [usuarioId, setUsuarioId] = useState<number | null>(null);

  const [prospectos,     setProspectos]     = useState<ProspectoRaw[]>([]);
  const [clientes,       setClientes]       = useState<ClienteRaw[]>([]);
  const [facturas,       setFacturas]       = useState<FacturaRaw[]>([]);
  const [notasCredito,   setNotasCredito]   = useState<NotaCreditoDashRow[]>([]);
  const [suscripciones,  setSuscripciones]  = useState<SuscripcionDashRow[]>([]);
  const [pagos,          setPagos]          = useState<PagoRaw[]>([]);
  const [tipificaciones, setTipificaciones] = useState<TipificacionRaw[]>([]);
  const [productos,      setProductos]      = useState<ProductoRaw[]>([]);
  const [ventas,         setVentas]         = useState<VentaRaw[]>([]);
  const [compras,        setCompras]        = useState<CompraRaw[]>([]);
  const [gastos,         setGastos]         = useState<GastoRaw[]>([]);
  // Sincronizar tab con URL al cargar (popstate / refresh)
  useEffect(() => {
    const syncFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const t = params.get("tab");
      if (t && isDashboardTabSlug(t)) setTab(t);
    };
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchWithSupabaseSession("/api/empresas/mis-dashboard-views", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) {
          if (!cancelled) setDashScope({ kind: "legacy" });
          return;
        }
        const j = (await r.json()) as {
          views?: { slug: string }[];
          defaultSlug?: string | null;
        };
        const slugs = (j.views ?? [])
          .map((v) => v.slug)
          .filter((s): s is TabDash => isDashboardTabSlug(s));
        if (slugs.length === 0) {
          if (!cancelled) setDashScope({ kind: "empty" });
          return;
        }
        const defRaw = j.defaultSlug ?? null;
        const defaultTab =
          defRaw && isDashboardTabSlug(defRaw) && slugs.includes(defRaw) ? defRaw : slugs[0];
        if (!cancelled) setDashScope({ kind: "scoped", tabs: slugs, defaultTab });
      })
      .catch(() => {
        if (!cancelled) setDashScope({ kind: "legacy" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (dashScope.kind !== "scoped") return;
    const params = new URLSearchParams(window.location.search);
    const t = params.get("tab");
    const next =
      t && isDashboardTabSlug(t) && dashScope.tabs.includes(t) ? t : dashScope.defaultTab;
    setTab(next);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `?tab=${next}`);
    }
  }, [dashScope]);

  useEffect(() => {
    setConfig(getConfig());
    const us = getUsuarios();
    setUsuarios(us);

    // Cargar sesión activa o default al primer admin
    const saved = localStorage.getItem("neura_dash_usuario");
    const savedId = saved ? parseInt(saved, 10) : null;
    const defaultUser = us.find(u => u.nivel === "administrador") ?? us[0] ?? null;
    setUsuarioId(savedId ?? defaultUser?.id ?? null);

    // Datos de módulos desde Supabase
    getDashboardData()
      .then((data) => {
        setProspectos(data.prospectos);
        setClientes(data.clientes);
        setFacturas(data.facturas);
        setNotasCredito(data.notas_credito ?? []);
        setSuscripciones(data.suscripciones);
        setPagos(data.pagos);
        setTipificaciones(data.tipificaciones);
        setProductos(data.productos);
        setVentas(data.ventas);
        setCompras(data.compras);
        setGastos(data.gastos);
      })
      .catch(() => {
        setProspectos([]);
        setClientes([]);
        setFacturas([]);
        setNotasCredito([]);
        setSuscripciones([]);
        setPagos([]);
        setTipificaciones([]);
        setProductos([]);
        setVentas([]);
        setCompras([]);
        setGastos([]);
      });
  }, []);

  function handleUsuarioChange(id: number) {
    setUsuarioId(id);
    localStorage.setItem("neura_dash_usuario", String(id));
  }

  const usuarioActivo = usuarios.find(u => u.id === usuarioId) ?? null;
  const mapNombreTipoServicio = useMapNombreTipoServicioCatalogo(clientes);
  const nivel = usuarioActivo?.nivel ?? "administrador";

  // Instancia En lo de Mari: solo Ventas / Inventario / Financiero (sin Comercial/CRM/Pipeline).
  const MARI_ALLOWED_TABS: TabDash[] = ["ventas", "inventario", "financiero", "compras"];
  // 'compras' es un tab nuevo que aun no esta registrado en el catalogo
  // dashboard_views de la DB. Lo inyectamos siempre para que aparezca sin
  // depender de una migracion.
  const rawTabs: TabDash[] = dashScope.kind === "scoped"
    ? Array.from(new Set<TabDash>([...dashScope.tabs, "compras"]))
    : TAB_VALID;
  const effectiveTabs: TabDash[] = rawTabs.filter((t) => MARI_ALLOWED_TABS.includes(t));
  const showTabNav = effectiveTabs.length > 1;

  // Si el tab actual no está permitido, redirigir al primero permitido.
  useEffect(() => {
    if (effectiveTabs.length > 0 && !effectiveTabs.includes(tab)) {
      setTab(effectiveTabs[0]);
      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", `?tab=${effectiveTabs[0]}`);
      }
    }
  }, [tab, effectiveTabs]);

  const TAB_META: Record<TabDash, { label: string; Icon: LucideIcon }> = {
    comercial: { label: "Comercial", Icon: BarChart3 },
    financiero: { label: "Financiero", Icon: Wallet },
    inventario: { label: "Inventario", Icon: Package },
    ventas: { label: "Ventas", Icon: ShoppingCart },
    compras: { label: "Compras", Icon: Truck },
  };

  if (!config) {
    return (
      <div
        className="zentra-dashboard-shell flex min-h-[40vh] items-center justify-center rounded-2xl py-24 text-sm"
        style={{ color: Z.muted }}
      >
        Cargando…
      </div>
    );
  }

  // Control de acceso
  if (nivel === "usuario") {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <span className="text-4xl">🔒</span>
        <h2 className="text-lg font-bold text-gray-800">Acceso restringido</h2>
        <p className="text-sm text-gray-500 text-center max-w-sm">
          El dashboard solo está disponible para usuarios con nivel <strong>Supervisor</strong> o <strong>Administrador</strong>.
        </p>
        <div className="flex items-center gap-2 text-sm text-gray-500 mt-2">
          Cambiar a:
          {usuarios.filter(u => u.nivel !== "usuario").map(u => (
            <button key={u.id} onClick={() => handleUsuarioChange(u.id)}
              className="px-3 py-1.5 rounded-lg bg-[#0EA5E9] hover:bg-[#0284C7] text-white text-xs font-medium transition-colors">
              {u.nombre}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (dashScope.kind === "empty") {
    return (
      <div
        className="zentra-dashboard-shell space-y-8 rounded-2xl border border-slate-200 px-4 py-8 sm:px-6 md:px-8"
        style={{ color: Z.muted }}
      >
        <header className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <ZentraMark />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: Z.accent }}>
                Zentra
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl" style={{ color: Z.text }}>
                Dashboard
              </h1>
              <p className="mt-1 max-w-md text-sm leading-relaxed" style={{ color: Z.muted }}>
                No hay vistas del tablero disponibles para tu usuario.
              </p>
            </div>
          </div>
        </header>
        <div
          className="rounded-2xl border border-slate-200 px-5 py-10 text-center text-sm"
          style={{ backgroundColor: Z.surface, color: Z.muted }}
        >
          <p className="font-medium" style={{ color: Z.text }}>
            Sin vistas asignadas
          </p>
          <p className="mt-2 max-w-md mx-auto">
            Tu empresa aún no habilitó pestañas para vos, o tu perfil no tiene vistas del dashboard. Pedí a un
            administrador que revise <span className="font-semibold">Usuarios</span> y las vistas habilitadas para la
            empresa.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* MOBILE (< md=768px): dashboard rediseñado especialmente para mobile.
          Touch-first, KPIs apilados, acciones rápidas grandes, alertas, cards
          en vez de tablas. Layout COMPLETAMENTE distinto al desktop. */}
      <div className="lg:hidden">
        <MobileDashboard
          clientes={clientes}
          facturas={facturas}
          pagos={pagos}
          productos={productos}
          ventas={ventas}
          gastos={gastos}
          notasCredito={notasCredito}
        />
      </div>

      {/* DESKTOP (>= md=768px): dashboard original con todos los sub-tabs,
          gráficos, tablas. Intacto, cero cambios. */}
      <div
      className="hidden lg:block zentra-dashboard-shell space-y-8 rounded-2xl border border-slate-200 px-4 py-8 sm:px-6 md:px-8"
      style={{ color: Z.muted }}
    >
      <header className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-4">
          <ZentraMark />
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: Z.accent }}>
              Zentra
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl" style={{ color: Z.text }}>
              Dashboard
            </h1>
            <p className="mt-1 max-w-md text-sm leading-relaxed" style={{ color: Z.muted }}>
              Neura ERP · Vista {nivel === "supervisor" ? "de tu área" : "global"} · período alineado al filtro
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          {usuarios.length > 0 && (
            <div className="flex flex-col gap-1.5 sm:items-end">
              <span className="text-[10px] uppercase tracking-wide" style={{ color: Z.muted }}>
                Viendo como
              </span>
              <select
                value={usuarioId ?? ""}
                onChange={(e) => handleUsuarioChange(parseInt(e.target.value, 10))}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-offset-0"
                style={{ backgroundColor: Z.surface, color: Z.text, borderColor: "rgba(255,255,255,0.12)" }}
              >
                {usuarios.map((u) => (
                  <option key={u.id} value={u.id} style={{ backgroundColor: Z.surface }}>
                    {u.nombre} ({u.nivel})
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 p-1" style={{ backgroundColor: Z.surface }}>
            {PERIODO_OPTS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPeriodo(p.id)}
                className="rounded-lg px-3 py-2 text-xs font-medium transition-all"
                style={
                  periodo === p.id
                    ? { backgroundColor: Z.accent, color: Z.text }
                    : { color: Z.muted, backgroundColor: "transparent" }
                }
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {showTabNav ? (
        <nav
          className="flex w-full flex-wrap gap-1 rounded-2xl border border-slate-200 p-1.5 sm:w-fit"
          style={{ backgroundColor: Z.surface }}
        >
          {effectiveTabs.map((tid) => {
            const meta = TAB_META[tid];
            return (
              <button
                key={tid}
                type="button"
                onClick={() => {
                  setTab(tid);
                  if (typeof window !== "undefined") {
                    window.history.replaceState(null, "", `?tab=${tid}`);
                  }
                }}
                className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all"
                style={
                  tab === tid
                    ? { backgroundColor: Z.accent, color: Z.text, boxShadow: "0 8px 24px rgba(37,99,235,0.35)" }
                    : { color: Z.muted }
                }
              >
                <meta.Icon className="h-4 w-4" strokeWidth={2} aria-hidden />
                {meta.label}
              </button>
            );
          })}
        </nav>
      ) : null}

      {/* Contenido */}
      {tab === "comercial" && (
        <DashComercial
          prospectos={prospectos}
          clientes={clientes}
          mapNombreTipoServicio={mapNombreTipoServicio}
          tipificaciones={tipificaciones}
          usuario={usuarioActivo}
          periodo={periodo}
          config={config}
          facturas={facturas}
          notasCredito={notasCredito}
          suscripciones={suscripciones}
        />
      )}

      {tab === "financiero" && (
        <div className="space-y-6">
          <CobranzasResumenCards />
          <DashFinanciero
            facturas={facturas}
            pagos={pagos}
            clientes={clientes}
            ventas={ventas}
            periodo={periodo}
            config={config}
            mapNombreTipoServicio={mapNombreTipoServicio}
          />
        </div>
      )}

      {tab === "inventario" && (
        <DashInventario
          productos={productos}
          compras={compras}
        />
      )}

      {tab === "ventas" && (
        <DashVentas
          ventas={ventas}
          productos={productos}
          periodo={periodo}
        />
      )}

      {tab === "compras" && (
        <DashCompras compras={compras} periodo={periodo} />
      )}

    </div>
    </>
  );
}
