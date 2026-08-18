"use client";

import { ChevronDown, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ConfigMetricCard } from "@/components/config/global-config-primitives";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

const BASE_LABEL: Record<string, string> = {
  pago_registrado: "Cobros registrados",
  factura_emitida: "Facturas emitidas",
  factura_pagada: "Facturas cobradas",
};

const MOVIMIENTO_LABEL: Record<string, string> = {
  pago: "Cobro registrado",
  factura_emitida: "Factura emitida",
  factura_pagada: "Factura cobrada",
};

type Linea = {
  tipo: string;
  cliente_label: string;
  factura_id: string | null;
  numero_factura?: string | null;
  pago_id: string | null;
  fecha: string | null;
  monto_base: number;
  comision_estimada_linea: number;
  cobrado_periodo: number;
  saldo_pendiente: number;
  pendiente_por_comisionar: number;
};

type VendedorRow = {
  vendedor_usuario_id: string;
  vendedor_nombre: string;
  cantidad_movimientos: number;
  revenue_base: number;
  cobrado_periodo_total: number;
  saldo_pendiente_total: number;
  pendiente_por_comisionar_total: number;
  escala_aplicada: string;
  porcentaje_tramo: number;
  premio_fijo_tramo: number;
  escala_actual_desde: number | null;
  escala_actual_hasta: number | null;
  escala_actual_porcentaje: number | null;
  escala_actual_premio_fijo: number | null;
  siguiente_escala_desde: number | null;
  siguiente_escala_porcentaje: number | null;
  falta_para_siguiente_escala: number | null;
  progreso_hacia_siguiente_pct: number | null;
  max_escala_alcanzada: boolean;
  comision_estimada: number;
  lineas: Linea[];
};

type PreviewMeta = {
  preview?: boolean;
  periodo?: string;
  timezone?: string;
  modo_periodo?: string;
  fecha_inicio_local?: string;
  fecha_fin_local?: string;
  periodo_mes?: string;
  politica_nombre?: string;
  base_calculo?: string;
  sin_escalas?: boolean;
  alcance?: string;
  viewer_role?: string | null;
  viewer_scope?: "admin" | "vendedor";
  viewer_usuario_id?: string;
  is_vendedor_view?: boolean;
  vendedor_detectado_por?: string;
  vendedor_clientes_asignados?: number;
  supervisor_equipos_pendiente?: boolean;
  /** Si no se pudieron cargar NC, el neto va sin descontar aprobadas. */
  alerta_neto_sin_nc?: string | null;
  documentacion_base?: Record<string, string>;
};

type PreviewKpis = {
  revenue_base_total: number;
  comision_estimada_total: number;
  cobrado_periodo_total: number;
  saldo_pendiente_total: number;
  pendiente_por_comisionar_total: number;
  vendedores_con_comision: number;
  fuentes_sin_vendedor: number;
  alertas_sin_vendedor_pagos: number;
  alertas_sin_vendedor_facturas: number;
};

type PreviewPayload = {
  estado: string;
  mensaje?: string;
  meta: PreviewMeta | null;
  kpis: PreviewKpis | null;
  por_vendedor: VendedorRow[];
};

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("es-PY", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${new Intl.NumberFormat("es-PY", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n)}%`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const ymd = iso.slice(0, 10);
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function currentMonthInputValue(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function escalaActualLabel(r: VendedorRow): string {
  if (r.escala_actual_porcentaje == null) {
    return r.siguiente_escala_desde == null ? "Sin escalas configuradas" : "Sin escala alcanzada todavía";
  }
  return `Escala actual: ${fmtPct(r.escala_actual_porcentaje)}`;
}

function siguienteEscalaLabel(r: VendedorRow): string {
  if (r.escala_actual_porcentaje == null && r.siguiente_escala_desde == null) return "Configurá escalas para medir el progreso.";
  if (r.max_escala_alcanzada) return "Máxima escala alcanzada";
  if (r.siguiente_escala_desde == null) return "Sin siguiente escala";
  return `Siguiente escala: ${fmtPct(r.siguiente_escala_porcentaje)} desde ${fmtMoney(r.siguiente_escala_desde)}`;
}

function faltaEscalaLabel(r: VendedorRow): string {
  if (r.max_escala_alcanzada) return "Ya estás en el tramo más alto.";
  if (r.falta_para_siguiente_escala == null) return "Sin escala siguiente configurada.";
  if (r.falta_para_siguiente_escala <= 0) return "Ya alcanzaste la siguiente escala.";
  return `Te faltan ₲ ${fmtMoney(r.falta_para_siguiente_escala)} para llegar a la siguiente escala.`;
}

/** Texto claro para KPIs de movimientos sin vendedor (sin exponer nombres de columnas técnicas). */
function mensajeFuentesSinVendedor(k: PreviewKpis): string {
  const total = k.fuentes_sin_vendedor;
  return `Hay ${total} ${total === 1 ? "movimiento" : "movimientos"} de clientes sin vendedor asignado. Asigná un vendedor responsable en la ficha del cliente para incluirlos en el cálculo.`;
}

function ScaleProgress({ row, compact = false }: { row: VendedorRow; compact?: boolean }) {
  const progress = row.max_escala_alcanzada ? 100 : row.progreso_hacia_siguiente_pct ?? 0;

  if (row.escala_actual_porcentaje == null && row.siguiente_escala_desde == null) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
        Sin escalas configuradas para esta política.
      </div>
    );
  }

  return (
    <div className={compact ? "space-y-2" : "rounded-xl border border-slate-100 bg-slate-50 p-4"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900">{escalaActualLabel(row)}</p>
          <p className="text-xs text-slate-500">{siguienteEscalaLabel(row)}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
          row.max_escala_alcanzada ? "bg-emerald-100 text-emerald-800" : "bg-sky-100 text-sky-800"
        }`}>
          {row.max_escala_alcanzada ? "Máxima escala" : `${progress}%`}
        </span>
      </div>
      <div className="h-2 rounded-full bg-white ring-1 ring-slate-200">
        <div
          className="h-2 rounded-full bg-sky-500 transition-all"
          style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
        />
      </div>
      <p className="text-xs text-slate-600">{faltaEscalaLabel(row)}</p>
    </div>
  );
}

function MiniScaleSummary({ row }: { row: VendedorRow }) {
  const progress = row.max_escala_alcanzada ? 100 : row.progreso_hacia_siguiente_pct ?? 0;
  return (
    <div className="min-w-[180px] text-left sm:text-right">
      <p className="text-[10px] font-semibold uppercase text-slate-400">Progreso de escala</p>
      <p className="text-xs font-semibold text-slate-700">{row.max_escala_alcanzada ? "Máxima escala alcanzada" : faltaEscalaLabel(row)}</p>
      <div className="mt-1 h-1.5 rounded-full bg-slate-100">
        <div
          className="h-1.5 rounded-full bg-sky-500"
          style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
        />
      </div>
    </div>
  );
}

function TotalsStrip({ row }: { row: VendedorRow }) {
  return (
    <div className="grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-5">
      <ConfigMetricCard label="Base comisionable" value={fmtMoney(row.revenue_base)} />
      <ConfigMetricCard label="Comisión estimada" value={fmtMoney(row.comision_estimada)} />
      <ConfigMetricCard label="Cobrado" value={fmtMoney(row.cobrado_periodo_total ?? 0)} />
      <ConfigMetricCard label="Pendiente de cobro" value={fmtMoney(row.saldo_pendiente_total ?? 0)} />
      <ConfigMetricCard label="Pendiente por comisionar" value={fmtMoney(row.pendiente_por_comisionar_total ?? 0)} />
    </div>
  );
}

function SellerTotalsSummary({ row }: { row: VendedorRow }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Sumatoria del período</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <p className="text-xs text-slate-500">Base comisionable</p>
          <p className="text-base font-bold tabular-nums text-slate-900">₲ {fmtMoney(row.revenue_base)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Comisión estimada</p>
          <p className="text-base font-bold tabular-nums text-emerald-800">₲ {fmtMoney(row.comision_estimada)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Cobrado</p>
          <p className="text-base font-bold tabular-nums text-slate-900">₲ {fmtMoney(row.cobrado_periodo_total ?? 0)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Pendiente de cobro</p>
          <p className="text-base font-bold tabular-nums text-slate-900">₲ {fmtMoney(row.saldo_pendiente_total ?? 0)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Pendiente por comisionar</p>
          <p className="text-base font-bold tabular-nums text-slate-900">
            ₲ {fmtMoney(row.pendiente_por_comisionar_total ?? 0)}
          </p>
        </div>
      </div>
    </div>
  );
}

function SellerMovimientosList({ row }: { row: VendedorRow }) {
  return (
    <div className="mt-3 grid gap-3">
      {row.lineas.map((ln, i) => (
        <article
          key={`${ln.pago_id ?? ""}-${ln.factura_id ?? ""}-${i}`}
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{ln.cliente_label}</p>
              <p className="mt-1 text-xs text-slate-500">
                {MOVIMIENTO_LABEL[ln.tipo] ?? "Movimiento"} · {ln.numero_factura ?? "Sin comprobante"} · {formatDate(ln.fecha)}
              </p>
            </div>
            <div className="text-left sm:text-right">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Comisión estimada</p>
              <p className="text-sm font-bold tabular-nums text-emerald-800">₲ {fmtMoney(ln.comision_estimada_linea)}</p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs text-slate-500">Base comisionable</p>
              <p className="text-sm font-semibold tabular-nums text-slate-900">₲ {fmtMoney(ln.monto_base)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Cobrado</p>
              <p className="text-sm font-semibold tabular-nums text-slate-900">₲ {fmtMoney(ln.cobrado_periodo ?? 0)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Pendiente</p>
              <p className="text-sm font-semibold tabular-nums text-slate-900">₲ {fmtMoney(ln.saldo_pendiente ?? 0)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Pendiente por comisionar</p>
              <p className="text-sm font-semibold tabular-nums text-slate-900">
                ₲ {fmtMoney(ln.pendiente_por_comisionar ?? 0)}
              </p>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function MovimientosTable({ row }: { row: VendedorRow }) {
  return (
    <div className="overflow-x-auto">
      <table className="mt-3 w-full min-w-[980px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
            <th className="py-2 pr-2">Cliente</th>
            <th className="py-2 pr-2">Movimiento</th>
            <th className="py-2 pr-2">Comprobante</th>
            <th className="py-2 pr-2">Fecha</th>
            <th className="py-2 pr-2 text-right">Base comisionable</th>
            <th className="py-2 pr-2 text-right">Comisión estimada</th>
            <th className="py-2 pr-2 text-right">Cobrado</th>
            <th className="py-2 pr-2 text-right">Pendiente</th>
            <th className="py-2 text-right">Pendiente por comisionar</th>
          </tr>
        </thead>
        <tbody>
          {row.lineas.map((ln, i) => (
            <tr key={`${ln.pago_id ?? ""}-${ln.factura_id ?? ""}-${i}`} className="border-b border-slate-50">
              <td className="py-2 pr-2 text-slate-800">{ln.cliente_label}</td>
              <td className="py-2 pr-2 text-xs text-slate-600">{MOVIMIENTO_LABEL[ln.tipo] ?? "Movimiento"}</td>
              <td className="py-2 pr-2 text-xs text-slate-700">{ln.numero_factura ?? "—"}</td>
              <td className="py-2 pr-2 text-xs text-slate-600">{formatDate(ln.fecha)}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{fmtMoney(ln.monto_base)}</td>
              <td className="py-2 pr-2 text-right tabular-nums text-emerald-800">
                {fmtMoney(ln.comision_estimada_linea)}
              </td>
              <td className="py-2 pr-2 text-right tabular-nums">{fmtMoney(ln.cobrado_periodo ?? 0)}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{fmtMoney(ln.saldo_pendiente ?? 0)}</td>
              <td className="py-2 text-right tabular-nums">{fmtMoney(ln.pendiente_por_comisionar ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderVendedorView({
  meta,
  sellerRow,
  selectedSellerMonth,
  onMonthChange,
}: {
  meta: PreviewMeta | null | undefined;
  sellerRow: VendedorRow | null;
  selectedSellerMonth: string;
  onMonthChange: (mes: string) => void;
}) {
  return (
    <div className="mx-auto max-w-5xl space-y-6 overflow-hidden px-4 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Mi comisión del mes</h1>
            <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Período</p>
            <p className="mt-1 text-lg font-semibold capitalize text-slate-900">{meta?.periodo ?? "—"}</p>
            <p className="text-xs text-slate-500">
              {meta?.fecha_inicio_local} → {meta?.fecha_fin_local}
            </p>
          </div>
          <label className="block text-left">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Mes a consultar</span>
            <input
              type="month"
              value={selectedSellerMonth}
              onChange={(e) => onMonthChange(e.target.value)}
              className="mt-1 block rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
            />
          </label>
        </div>
      </section>

      {!sellerRow ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center shadow-sm">
          <p className="text-sm font-semibold text-slate-800">Todavía no tenés movimientos comisionables en este período.</p>
          <p className="mt-1 text-sm text-slate-500">Cuando tus clientes registren movimientos dentro del período, vas a verlos acá.</p>
        </div>
      ) : (
        <>
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-sky-700">Mini dashboard</p>
                <h2 className="mt-1 text-xl font-bold text-slate-900">Mi comisión del mes</h2>
              </div>
              <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-900">
                {sellerRow.max_escala_alcanzada ? "Máxima escala alcanzada" : "En progreso"}
              </span>
            </div>

            <ScaleProgress row={sellerRow} />

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <ConfigMetricCard label="Base comisionable" value={fmtMoney(sellerRow.revenue_base)} />
              <ConfigMetricCard label="Comisión estimada" value={fmtMoney(sellerRow.comision_estimada)} />
              <ConfigMetricCard label="Cobrado" value={fmtMoney(sellerRow.cobrado_periodo_total ?? 0)} />
              <ConfigMetricCard label="Pendiente de cobro" value={fmtMoney(sellerRow.saldo_pendiente_total ?? 0)} />
              <ConfigMetricCard
                label="Pendiente por comisionar"
                value={fmtMoney(sellerRow.pendiente_por_comisionar_total ?? 0)}
              />
            </div>
          </section>

          <details className="group rounded-2xl border border-slate-200 bg-white shadow-sm open:shadow-md">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 pr-3 [&::-webkit-details-marker]:hidden">
              <div>
                <p className="font-semibold text-slate-900">Mis clientes y movimientos</p>
                <p className="text-xs text-slate-500">
                  {sellerRow.cantidad_movimientos} movimientos · Pendiente de cobro ₲ {fmtMoney(sellerRow.saldo_pendiente_total ?? 0)}
                </p>
              </div>
              <ChevronDown className="h-5 w-5 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
            </summary>
            <div className="space-y-4 border-t border-slate-100 px-4 pb-4">
              <SellerMovimientosList row={sellerRow} />
              <SellerTotalsSummary row={sellerRow} />
            </div>
          </details>
        </>
      )}
    </div>
  );
}

function renderAdminView({
  meta,
  kpis,
  rows,
  baseLabel,
  onReload,
}: {
  meta: PreviewMeta | null | undefined;
  kpis: PreviewKpis | null | undefined;
  rows: VendedorRow[];
  baseLabel: string;
  onReload: () => void;
}) {
  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Comisiones</h1>
          <p className="mt-1 text-sm text-slate-600">
            Seguimiento mensual de comisiones según la política activa.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onReload}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            Recalcular
          </button>
          <Link
            href="/configuracion/comisiones"
            className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
          >
            Configuración
          </Link>
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Período actual</p>
            <p className="mt-1 text-lg font-semibold capitalize text-slate-900">{meta?.periodo ?? "—"}</p>
            <p className="text-xs text-slate-500">
              {meta?.fecha_inicio_local} → {meta?.fecha_fin_local} · {meta?.timezone}
            </p>
          </div>
          <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-sky-900">
            En seguimiento
          </span>
        </div>
        <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <ConfigMetricCard label="Estado" value="Período actual" />
          <ConfigMetricCard label="Política activa" value={meta?.politica_nombre ?? "—"} />
          <ConfigMetricCard label="Base de cálculo" value={baseLabel} />
          <ConfigMetricCard
            label="Escalas"
            value={meta?.sin_escalas ? "Sin escalas" : "Configuradas"}
          />
        </div>
      </section>

      {kpis && (
        <section>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">Resumen</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <ConfigMetricCard label="Base comisionable total" value={fmtMoney(kpis.revenue_base_total)} />
            <ConfigMetricCard label="Comisión estimada total" value={fmtMoney(kpis.comision_estimada_total)} />
            <ConfigMetricCard label="Total cobrado" value={fmtMoney(kpis.cobrado_periodo_total ?? 0)} />
            <ConfigMetricCard label="Total pendiente de cobro" value={fmtMoney(kpis.saldo_pendiente_total ?? 0)} />
            <ConfigMetricCard
              label="Pendiente por comisionar"
              value={fmtMoney(kpis.pendiente_por_comisionar_total ?? 0)}
            />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <ConfigMetricCard label="Vendedores con comisión" value={kpis.vendedores_con_comision} />
            <ConfigMetricCard
              label="Movimientos sin vendedor"
              value={kpis.fuentes_sin_vendedor}
              sub={kpis.fuentes_sin_vendedor > 0 ? "Se incluirán al asignar vendedor responsable" : undefined}
            />
          </div>
          {kpis.fuentes_sin_vendedor > 0 && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <p>{mensajeFuentesSinVendedor(kpis)}</p>
              <div className="mt-3">
                <Link
                  href="/clientes"
                  className="inline-flex rounded-lg bg-amber-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-950"
                >
                  Ir a Clientes
                </Link>
              </div>
            </div>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">Por vendedor</h2>
        {rows.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
            No hay movimientos con vendedor asignado en este período para la base seleccionada.
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => (
              <details
                key={r.vendedor_usuario_id}
                className="group rounded-2xl border border-slate-200 bg-white shadow-sm open:shadow-md"
              >
                <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-4 py-4 pr-3 [&::-webkit-details-marker]:hidden">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{r.vendedor_nombre}</p>
                    <p className="text-xs text-slate-500">
                      {r.cantidad_movimientos} movimientos · {escalaActualLabel(r)} · {r.max_escala_alcanzada ? "Máxima escala" : faltaEscalaLabel(r)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-right">
                    <div>
                      <p className="text-[10px] font-semibold uppercase text-slate-400">Base comisionable</p>
                      <p className="text-sm font-bold tabular-nums text-slate-800">{fmtMoney(r.revenue_base)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase text-slate-400">Comisión estimada</p>
                      <p className="text-sm font-bold tabular-nums text-emerald-800">{fmtMoney(r.comision_estimada)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase text-slate-400">Pendiente</p>
                      <p className="text-sm font-bold tabular-nums text-slate-800">{fmtMoney(r.saldo_pendiente_total ?? 0)}</p>
                    </div>
                    <MiniScaleSummary row={r} />
                    <ChevronDown className="h-5 w-5 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
                  </div>
                </summary>
                <div className="border-t border-slate-100 px-4 pb-4">
                  <div className="mt-4">
                    <TotalsStrip row={r} />
                  </div>
                  <MovimientosTable row={r} />
                </div>
              </details>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default function ComisionesPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PreviewPayload | null>(null);
  const [sellerMonth, setSellerMonth] = useState("");

  const load = useCallback(async (opts?: { mes?: string }) => {
    setLoading(true);
    setError(null);
    try {
      const qs = opts?.mes ? `?mes=${encodeURIComponent(opts.mes)}` : "";
      const res = await fetchWithSupabaseSession(`/api/comisiones/preview${qs}`, { cache: "no-store" });
      const json = (await res.json()) as { success?: boolean; data?: PreviewPayload; error?: string };
      if (!res.ok || json.success !== true || !json.data) {
        throw new Error(json.error ?? `Error ${res.status}`);
      }
      setData(json.data);
      if (!opts?.mes && json.data.meta?.alcance === "solo_vendedor_autenticado") {
        setSellerMonth(json.data.meta.periodo_mes ?? currentMonthInputValue());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 text-center text-sm text-slate-500">
        Cargando seguimiento de comisiones…
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-sky-700 hover:underline"
        >
          <RefreshCw className="h-4 w-4" />
          Reintentar
        </button>
      </div>
    );
  }

  const estado = data?.estado ?? "";
  const meta = data?.meta;
  const kpis = data?.kpis;
  const rows = data?.por_vendedor ?? [];

  if (estado === "sin_politica" || estado === "politica_inactiva") {
    return (
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Comisiones</h1>
          <p className="mt-1 text-sm text-slate-600">{data?.mensaje}</p>
        </div>
        <Link
          href="/configuracion/comisiones"
          className="inline-flex rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-900 hover:bg-sky-100"
        >
          Ir a Configuración → Comisiones
        </Link>
      </div>
    );
  }

  const baseLabel = BASE_LABEL[meta?.base_calculo ?? ""] ?? meta?.base_calculo ?? "—";
  const isSellerView =
    meta?.is_vendedor_view === true ||
    meta?.viewer_scope === "vendedor" ||
    meta?.alcance === "solo_vendedor_autenticado";
  const sellerRow = rows[0] ?? null;
  const selectedSellerMonth = sellerMonth || meta?.periodo_mes || currentMonthInputValue();

  if (isSellerView) {
    return renderVendedorView({
      meta,
      sellerRow,
      selectedSellerMonth,
      onMonthChange: (mes) => {
        setSellerMonth(mes);
        if (mes) void load({ mes });
      },
    });
  }

  return renderAdminView({
    meta,
    kpis,
    rows,
    baseLabel,
    onReload: () => void load(),
  });
}
