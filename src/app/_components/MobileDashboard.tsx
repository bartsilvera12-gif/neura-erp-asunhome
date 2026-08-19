"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Calendar,
  Plus,
  ShoppingCart,
  Package,
  Users,
  Receipt,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  ChevronRight,
  Wallet,
  Boxes,
  Home as HomeIcon,
} from "lucide-react";
import {
  esFacturaAnulada,
  esFacturaCorregidaNc,
  buildMontoNcAprobadaPorFacturaId,
  montoFacturaNetoValorComercial,
  type ClienteRaw,
  type FacturaRaw,
  type PagoRaw,
  type ProductoRaw,
  type VentaRaw,
  type GastoRaw,
  type NotaCreditoDashRow,
} from "@/lib/dashboard/data";
// IMPORTANTE: usar enRangoCalendario en vez de "new Date(iso) >= desde && <= hasta".
// Las fechas en BD vienen como "YYYY-MM-DD" (date only). Si haces new Date("2026-05-25")
// JS lo parsea como UTC midnight, que en Paraguay (UTC-3) es 24/05 21:00 LOCAL.
// Resultado: una venta del 25/05 NO matchea el rango "hoy 25/05 00:00 - 23:59 LOCAL".
// enRangoCalendario compara string vs string YYYY-MM-DD ignorando timezone.
import { enRangoCalendario } from "@/lib/fechas/calendario";

/**
 * MobileDashboard — versión mobile-first del dashboard.
 *
 * SE RENDERIZA SOLO en mobile (md:hidden en el wrapper del padre).
 * El dashboard desktop sigue intacto en page.tsx.
 *
 * Diseño:
 *  1. Header sticky con selector de período compacto.
 *  2. KPI principal grande (facturado del período).
 *  3. 2 KPIs secundarios (cobrado + pendiente).
 *  4. 4 acciones rápidas grandes (nueva venta, pedido, compra, cliente).
 *  5. Alertas (stock crítico + facturas vencidas) — solo si existen.
 *  6. Resumen mensual compacto (ventas, gastos, margen).
 *  7. Últimas ventas como cards (no tabla).
 *
 * Touch-first: tap targets >= 48px, espaciado generoso, sin tablas.
 */

type Periodo = "hoy" | "7d" | "30d" | "mes" | "anio";

const PERIODO_LABELS: Record<Periodo, string> = {
  hoy: "Hoy",
  "7d": "Últimos 7 días",
  "30d": "Últimos 30 días",
  mes: "Mes actual",
  anio: "Año",
};

function getRangoFechas(periodo: Periodo): { desde: Date; hasta: Date } {
  const ahora = new Date();
  switch (periodo) {
    case "hoy": {
      const desde = new Date(ahora);
      desde.setHours(0, 0, 0, 0);
      const hasta = new Date(ahora);
      hasta.setHours(23, 59, 59, 999);
      return { desde, hasta };
    }
    case "7d": {
      const hasta = new Date(ahora);
      hasta.setHours(23, 59, 59, 999);
      const desde = new Date(ahora);
      desde.setDate(desde.getDate() - 7);
      desde.setHours(0, 0, 0, 0);
      return { desde, hasta };
    }
    case "30d": {
      const hasta = new Date(ahora);
      hasta.setHours(23, 59, 59, 999);
      const desde = new Date(ahora);
      desde.setDate(desde.getDate() - 30);
      desde.setHours(0, 0, 0, 0);
      return { desde, hasta };
    }
    case "mes": {
      const desde = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
      const hasta = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0, 23, 59, 59, 999);
      return { desde, hasta };
    }
    case "anio": {
      const desde = new Date(ahora.getFullYear(), 0, 1);
      const hasta = new Date(ahora.getFullYear(), 11, 31, 23, 59, 59, 999);
      return { desde, hasta };
    }
  }
}

/**
 * Formato de monto guaraní con separadores de miles.
 * Ej: 268000 -> "Gs. 268.000"
 *     1250000 -> "Gs. 1.250.000"
 *
 * Antes habia dos funciones: formatGs (completo) y formatGsCompact (K/M/MM).
 * El usuario prefiere ver el numero real ("268.000" en vez de "268 K"),
 * asi que solo dejamos la version completa. Si en el futuro algun monto se
 * desborda en mobile (ej: > 1.000.000.000), evaluar truncar con CSS o
 * reintroducir el compact selectivamente.
 */
function formatGs(n: number): string {
  return `Gs. ${Math.round(n).toLocaleString("es-PY")}`;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("es-PY", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function formatFecha(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("es-PY", {
      day: "2-digit",
      month: "2-digit",
    });
  } catch {
    return "";
  }
}

type Props = {
  clientes: ClienteRaw[];
  facturas: FacturaRaw[];
  pagos: PagoRaw[];
  productos: ProductoRaw[];
  ventas: VentaRaw[];
  gastos: GastoRaw[];
  notasCredito: NotaCreditoDashRow[];
};

type Seccion = "ventas" | "financiero" | "inventario";

export default function MobileDashboard({
  clientes,
  facturas,
  pagos,
  productos,
  ventas,
  gastos,
  notasCredito,
}: Props) {
  const [periodo, setPeriodo] = useState<Periodo>("hoy");
  const [seccion, setSeccion] = useState<Seccion>("ventas");
  const { desde, hasta } = useMemo(() => getRangoFechas(periodo), [periodo]);

  // ── Cálculos memoizados ──────────────────────────────────────────────────
  const ncPorFactura = useMemo(
    () => buildMontoNcAprobadaPorFacturaId(notasCredito),
    [notasCredito],
  );

  const metrics = useMemo(() => {
    // Facturas válidas en el período
    const facturasPeriodo = facturas.filter(
      (f) =>
        !esFacturaAnulada(f.estado) &&
        !esFacturaCorregidaNc(f.estado) &&
        enRangoCalendario(f.fecha, desde, hasta),
    );

    const facturadoTotal = facturasPeriodo.reduce(
      (s, f) => s + montoFacturaNetoValorComercial(f, ncPorFactura),
      0,
    );

    // Pagos en el período
    const pagosPeriodo = pagos.filter((p) => enRangoCalendario(p.fecha_pago, desde, hasta));
    const cobrado = pagosPeriodo.reduce((s, p) => s + (Number(p.monto) || 0), 0);

    // Pendiente: suma de saldos > 0 de facturas no anuladas (cartera total, no solo período)
    const pendiente = facturas
      .filter((f) => !esFacturaAnulada(f.estado) && !esFacturaCorregidaNc(f.estado))
      .reduce((s, f) => {
        const saldo = Number(f.saldo);
        return s + (Number.isFinite(saldo) && saldo > 0 ? saldo : 0);
      }, 0);

    // Ventas en período
    const ventasPeriodo = ventas.filter((v) => enRangoCalendario(v.fecha, desde, hasta));
    const totalVentas = ventasPeriodo.reduce((s, v) => s + (Number(v.total) || 0), 0);

    // Gastos en período
    const gastosPeriodo = gastos.filter((g) => enRangoCalendario(g.fecha, desde, hasta));
    const totalGastos = gastosPeriodo.reduce((s, g) => s + (Number(g.monto) || 0), 0);

    // Margen estimado (ventas - gastos)
    const margenBruto = totalVentas - totalGastos;
    const margenPct = totalVentas > 0 ? (margenBruto / totalVentas) * 100 : 0;

    return {
      facturadoTotal,
      cantidadFacturas: facturasPeriodo.length,
      cobrado,
      cantidadPagos: pagosPeriodo.length,
      pendiente,
      totalVentas,
      cantidadVentas: ventasPeriodo.length,
      totalGastos,
      margenBruto,
      margenPct,
    };
  }, [facturas, pagos, ventas, gastos, ncPorFactura, desde, hasta]);

  // Alertas ────────────────────────────────────────────────────────────────
  const alertas = useMemo(() => {
    const stockCritico = productos.filter(
      (p) => Number(p.stock_actual) <= Number(p.stock_minimo),
    ).length;

    // Facturas vencidas: fecha_vencimiento < hoy AND saldo > 0 AND no anulada
    const hoyDate = new Date();
    hoyDate.setHours(0, 0, 0, 0);
    const vencidas = facturas.filter((f) => {
      if (esFacturaAnulada(f.estado) || esFacturaCorregidaNc(f.estado)) return false;
      const saldo = Number(f.saldo);
      if (!Number.isFinite(saldo) || saldo <= 0) return false;
      if (!f.fecha_vencimiento) return false;
      const venc = new Date(f.fecha_vencimiento);
      return !isNaN(venc.getTime()) && venc < hoyDate;
    }).length;

    return { stockCritico, vencidas };
  }, [productos, facturas]);

  // ── Métricas FINANCIERO ────────────────────────────────────────────────
  // Cohorte fiscal: facturas emitidas en período, no anuladas.
  // facturado = obligación cobro al emitir; cartera = saldo vivo; recaudado = facturado - cartera.
  const financieroMetrics = useMemo(() => {
    const facturasPeriodo = facturas.filter(
      (f) => !esFacturaAnulada(f.estado) && enRangoCalendario(f.fecha, desde, hasta),
    );
    const facturadoCohort = facturasPeriodo.reduce(
      (s, f) => s + (Number(f.monto) || 0),
      0,
    );
    const carteraPendiente = facturasPeriodo.reduce((s, f) => {
      const saldo = Number(f.saldo);
      return s + (Number.isFinite(saldo) && saldo > 0 ? saldo : 0);
    }, 0);
    const recaudado = Math.max(0, facturadoCohort - carteraPendiente);
    const pctCobranza = facturadoCohort > 0 ? (recaudado / facturadoCohort) * 100 : 0;

    // Composición contado vs crédito (por tipo factura del período)
    let contado = 0;
    let credito = 0;
    for (const f of facturasPeriodo) {
      const monto = Number(f.monto) || 0;
      const tipo = (f.tipo ?? "").trim().toLowerCase();
      if (tipo === "contado") contado += monto;
      else credito += monto;
    }
    const totalComp = contado + credito;
    const pctContado = totalComp > 0 ? (contado / totalComp) * 100 : 0;

    return {
      facturadoCohort,
      carteraPendiente,
      recaudado,
      pctCobranza,
      contado,
      credito,
      pctContado,
      pctCredito: 100 - pctContado,
    };
  }, [facturas, desde, hasta]);

  // Top 5 deudores: clientes con mayor saldo pendiente (cartera total, no por período)
  const topDeudores = useMemo(() => {
    const saldoPorCliente = new Map<string, number>();
    for (const f of facturas) {
      if (esFacturaAnulada(f.estado) || esFacturaCorregidaNc(f.estado)) continue;
      const saldo = Number(f.saldo);
      if (!Number.isFinite(saldo) || saldo <= 0) continue;
      const cid = String(f.cliente_id);
      saldoPorCliente.set(cid, (saldoPorCliente.get(cid) ?? 0) + saldo);
    }
    const arr = Array.from(saldoPorCliente.entries()).map(([cid, saldo]) => {
      const cliente = clientes.find((c) => String(c.id) === cid);
      const nombre = cliente?.empresa?.trim() || cliente?.nombre_contacto?.trim() || `Cliente ${cid.slice(0, 8)}`;
      return { id: cid, nombre, saldo };
    });
    arr.sort((a, b) => b.saldo - a.saldo);
    return arr.slice(0, 5);
  }, [facturas, clientes]);

  // ── Métricas INVENTARIO ────────────────────────────────────────────────
  const inventarioMetrics = useMemo(() => {
    const totalProductos = productos.length;
    const totalUnidades = productos.reduce((s, p) => s + Number(p.stock_actual ?? 0), 0);
    const valorTotal = productos.reduce(
      (s, p) => s + Number(p.stock_actual ?? 0) * Number(p.costo_promedio ?? 0),
      0,
    );

    let saludable = 0;
    let bajo = 0;
    let critico = 0;
    for (const p of productos) {
      const actual = Number(p.stock_actual ?? 0);
      const minimo = Number(p.stock_minimo ?? 0);
      if (actual <= 0) critico++;
      else if (actual <= minimo) bajo++;
      else saludable++;
    }

    return { totalProductos, totalUnidades, valorTotal, saludable, bajo, critico };
  }, [productos]);

  // Top 5 productos críticos (más necesitados de reposición)
  const productosCriticos = useMemo(() => {
    return productos
      .filter((p) => Number(p.stock_actual ?? 0) <= Number(p.stock_minimo ?? 0))
      .map((p) => ({
        ...p,
        deficit: Math.max(0, Number(p.stock_minimo ?? 0) - Number(p.stock_actual ?? 0)),
      }))
      .sort((a, b) => b.deficit - a.deficit)
      .slice(0, 5);
  }, [productos]);

  // Últimas ventas (top 5 más recientes en el período)
  const ultimasVentas = useMemo(() => {
    return ventas
      .filter((v) => enRangoCalendario(v.fecha, desde, hasta))
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
      .slice(0, 5);
  }, [ventas, desde, hasta]);

  return (
    <div className="space-y-4">
      {/* ── Header: selector de período (sticky inside scrollable parent) ── */}
      <div className="sticky top-0 -mx-4 -mt-4 sm:-mx-6 sm:-mt-6 z-10 bg-[#F8FAFC] px-4 pt-4 pb-3 sm:px-6 sm:pt-6 border-b border-slate-200">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-xl font-bold text-slate-900">Inicio</h1>
          <div className="flex items-center gap-1 text-xs text-slate-500">
            <Calendar className="h-3.5 w-3.5" aria-hidden />
            <span>{PERIODO_LABELS[periodo]}</span>
          </div>
        </div>
        {/* Period selector — scrollable horizontal si no entran */}
        <div className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-1 scrollbar-none">
          {(["hoy", "7d", "30d", "mes", "anio"] as Periodo[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriodo(p)}
              className={`shrink-0 px-3 py-2 rounded-full text-xs font-semibold transition-all min-h-[36px] ${
                periodo === p
                  ? "bg-[#4FAEB2] text-white shadow-sm"
                  : "bg-white text-slate-600 border border-slate-200"
              }`}
            >
              {PERIODO_LABELS[p]}
            </button>
          ))}
        </div>
        {/* Selector de seccion: Ventas / Financiero / Inventario */}
        <div className="mt-2 grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl">
          <SectionTab active={seccion === "ventas"} onClick={() => setSeccion("ventas")} icon={ShoppingCart} label="Ventas" />
          <SectionTab active={seccion === "financiero"} onClick={() => setSeccion("financiero")} icon={Wallet} label="Financiero" />
          <SectionTab active={seccion === "inventario"} onClick={() => setSeccion("inventario")} icon={Boxes} label="Inventario" />
        </div>
      </div>

      {/* ════════════════════════ VENTAS ════════════════════════ */}
      {seccion === "ventas" && (
      <>
      {/* ── KPI principal: Total Ventas del periodo (tabla ventas, no facturas) ── */}
      <div className="bg-gradient-to-br from-[#4FAEB2] to-[#3F8E91] rounded-2xl p-5 text-white shadow-md">
        <p className="text-[10px] font-bold uppercase tracking-widest opacity-90 mb-2">
          Ventas {PERIODO_LABELS[periodo].toLowerCase()}
        </p>
        <p className="text-3xl font-bold tabular-nums leading-tight">
          {formatGs(metrics.totalVentas)}
        </p>
        <p className="text-xs opacity-90 mt-1">
          {metrics.cantidadVentas} venta{metrics.cantidadVentas === 1 ? "" : "s"}
        </p>
      </div>

      {/* ── 2 KPIs secundarios: Cobrado (pagos del periodo) + Gastos ── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="flex items-center gap-1.5 mb-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Cobrado
            </p>
          </div>
          <p className="text-base sm:text-lg font-bold text-slate-900 tabular-nums break-all leading-tight">
            {formatGs(metrics.cobrado)}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {metrics.cantidadPagos} pago{metrics.cantidadPagos === 1 ? "" : "s"}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="flex items-center gap-1.5 mb-1.5">
            <TrendingDown className="h-3.5 w-3.5 text-red-600" aria-hidden />
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Gastos
            </p>
          </div>
          <p className="text-base sm:text-lg font-bold text-slate-900 tabular-nums break-all leading-tight">
            {formatGs(metrics.totalGastos)}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">del período</p>
        </div>
      </div>

      {/* ── Acciones rápidas: 4 botones grandes ── */}
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2 px-1">
          Acciones rápidas
        </p>
        <div className="grid grid-cols-2 gap-3">
          <QuickAction href="/ventas/nueva" icon={ShoppingCart} label="Nueva venta" color="emerald" />
          <QuickAction href="/dashboard/proyectos/nuevo" icon={Receipt} label="Nuevo pedido" color="sky" />
          <QuickAction href="/compras/nueva" icon={Package} label="Nueva compra" color="violet" />
          <QuickAction href="/clientes/nuevo" icon={Users} label="Nuevo cliente" color="amber" />
        </div>
      </div>

      {/* ── Alertas ── */}
      {(alertas.stockCritico > 0 || alertas.vencidas > 0) && (
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2 px-1">
            Alertas
          </p>
          <div className="space-y-2">
            {alertas.stockCritico > 0 && (
              <Link
                href="/inventario"
                className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3 active:bg-amber-100 transition-colors"
              >
                <div className="shrink-0 w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center">
                  <AlertTriangle className="h-5 w-5 text-amber-700" aria-hidden />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-amber-900">
                    {alertas.stockCritico} producto{alertas.stockCritico === 1 ? "" : "s"} con stock crítico
                  </p>
                  <p className="text-[11px] text-amber-700 mt-0.5">Tocá para revisar inventario</p>
                </div>
                <ChevronRight className="h-5 w-5 text-amber-600 shrink-0" aria-hidden />
              </Link>
            )}
            {alertas.vencidas > 0 && (
              <Link
                href="/clientes"
                className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl p-3 active:bg-red-100 transition-colors"
              >
                <div className="shrink-0 w-9 h-9 rounded-full bg-red-100 flex items-center justify-center">
                  <AlertTriangle className="h-5 w-5 text-red-700" aria-hidden />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-red-900">
                    {alertas.vencidas} factura{alertas.vencidas === 1 ? "" : "s"} vencida{alertas.vencidas === 1 ? "" : "s"}
                  </p>
                  <p className="text-[11px] text-red-700 mt-0.5">Cartera con saldo vencido</p>
                </div>
                <ChevronRight className="h-5 w-5 text-red-600 shrink-0" aria-hidden />
              </Link>
            )}
          </div>
        </div>
      )}

      {/* ── Resumen período: ventas + gastos + margen ── */}
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2 px-1">
          Resumen {PERIODO_LABELS[periodo].toLowerCase()}
        </p>
        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 shadow-sm">
          <SummaryRow
            label="Total ventas"
            value={formatGs(metrics.totalVentas)}
            sub={`${metrics.cantidadVentas} venta${metrics.cantidadVentas === 1 ? "" : "s"}`}
          />
          <SummaryRow label="Total gastos" value={formatGs(metrics.totalGastos)} negative />
          <SummaryRow
            label="Margen bruto"
            value={formatGs(metrics.margenBruto)}
            sub={`${metrics.margenPct.toFixed(1)}% de las ventas`}
            highlight={metrics.margenBruto >= 0}
          />
          <SummaryRow
            label="Clientes activos"
            value={String(clientes.length)}
            sub="total en la base"
          />
        </div>
      </div>

      {/* ── Últimas ventas: cards ── */}
      {ultimasVentas.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2 px-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Últimas ventas
            </p>
            <Link
              href="/ventas"
              className="text-[11px] font-medium text-[#4FAEB2] active:underline"
            >
              Ver todas →
            </Link>
          </div>
          <div className="space-y-2">
            {ultimasVentas.map((v) => (
              <div
                key={String(v.id)}
                className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900 truncate">
                      {v.numero_control || `V-${String(v.id).slice(0, 8)}`}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {formatFecha(v.fecha)} · {formatTime(v.fecha)} ·{" "}
                      {v.tipo_venta === "CONTADO" ? "Contado" : "Crédito"}
                    </p>
                  </div>
                  <p className="text-sm font-bold text-slate-900 tabular-nums shrink-0">
                    {formatGs(Number(v.total) || 0)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state si no hay ventas en el período */}
      {ultimasVentas.length === 0 && (
        <div className="text-center py-6 px-4 bg-slate-50 rounded-xl border border-dashed border-slate-300">
          <p className="text-sm text-slate-500">
            No hay ventas en {PERIODO_LABELS[periodo].toLowerCase()}
          </p>
          <Link
            href="/ventas/nueva"
            className="inline-flex items-center gap-1 mt-2 text-sm font-medium text-[#4FAEB2] active:underline"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Crear primera venta
          </Link>
        </div>
      )}
      </>
      )}

      {/* ════════════════════════ FINANCIERO ════════════════════════ */}
      {seccion === "financiero" && (
      <>
        {/* KPI principal: cartera pendiente del período */}
        <div className="bg-gradient-to-br from-amber-500 to-amber-600 rounded-2xl p-5 text-white shadow-md">
          <p className="text-[10px] font-bold uppercase tracking-widest opacity-90 mb-2">
            Cartera pendiente del período
          </p>
          <p className="text-2xl sm:text-3xl font-bold tabular-nums leading-tight break-all">
            {formatGs(financieroMetrics.carteraPendiente)}
          </p>
          <p className="text-xs opacity-90 mt-1">
            Saldo vivo de facturas emitidas {PERIODO_LABELS[periodo].toLowerCase()}
          </p>
        </div>

        {/* Facturado + Recaudado */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Facturado</p>
            <p className="text-base sm:text-lg font-bold text-slate-900 tabular-nums break-all leading-tight">
              {formatGs(financieroMetrics.facturadoCohort)}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">cohorte fiscal</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <div className="flex items-center gap-1.5 mb-1.5">
              <TrendingUp className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Recaudado</p>
            </div>
            <p className="text-base sm:text-lg font-bold text-slate-900 tabular-nums break-all leading-tight">
              {formatGs(financieroMetrics.recaudado)}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {financieroMetrics.pctCobranza.toFixed(1)}% del cohorte
            </p>
          </div>
        </div>

        {/* Barra progreso cobranza */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-slate-700">Cobranza del cohorte</p>
            <p className="text-xs font-bold tabular-nums text-emerald-700">
              {financieroMetrics.pctCobranza.toFixed(1)}%
            </p>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-full transition-all"
              style={{ width: `${Math.min(100, financieroMetrics.pctCobranza)}%` }}
            />
          </div>
          <p className="text-[11px] text-slate-500 mt-2">
            Recaudado {formatGs(financieroMetrics.recaudado)} de{" "}
            {formatGs(financieroMetrics.facturadoCohort)} facturado.
          </p>
        </div>

        {/* Composición Contado vs Crédito */}
        {financieroMetrics.facturadoCohort > 0 && (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2 px-1">
              Composición {PERIODO_LABELS[periodo].toLowerCase()}
            </p>
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-slate-700">Contado</span>
                  <span className="text-xs tabular-nums font-bold text-emerald-700">
                    {formatGs(financieroMetrics.contado)} · {financieroMetrics.pctContado.toFixed(0)}%
                  </span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full"
                    style={{ width: `${financieroMetrics.pctContado}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-slate-700">Crédito / mensual</span>
                  <span className="text-xs tabular-nums font-bold text-sky-700">
                    {formatGs(financieroMetrics.credito)} · {financieroMetrics.pctCredito.toFixed(0)}%
                  </span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-sky-500 rounded-full"
                    style={{ width: `${financieroMetrics.pctCredito}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Top deudores */}
        {topDeudores.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2 px-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Top deudores (cartera total)
              </p>
              <Link href="/clientes" className="text-[11px] font-medium text-[#4FAEB2] active:underline">
                Ver todos →
              </Link>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 shadow-sm">
              {topDeudores.map((d, idx) => (
                <Link
                  key={d.id}
                  href={`/clientes/${d.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 active:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="shrink-0 w-7 h-7 rounded-full bg-amber-100 text-amber-800 text-xs font-bold flex items-center justify-center">
                      {idx + 1}
                    </span>
                    <p className="text-sm font-medium text-slate-900 truncate">{d.nombre}</p>
                  </div>
                  <p className="text-sm font-bold text-amber-700 tabular-nums shrink-0">
                    {formatGs(d.saldo)}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        )}
      </>
      )}

      {/* ════════════════════════ INVENTARIO ════════════════════════ */}
      {seccion === "inventario" && (
      <>
        {/* KPI principal: valor total inventario */}
        <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-2xl p-5 text-white shadow-md">
          <p className="text-[10px] font-bold uppercase tracking-widest opacity-90 mb-2">
            Valor total del inventario
          </p>
          <p className="text-2xl sm:text-3xl font-bold tabular-nums leading-tight break-all">
            {formatGs(inventarioMetrics.valorTotal)}
          </p>
          <p className="text-xs opacity-90 mt-1">
            {inventarioMetrics.totalProductos} productos ·{" "}
            {inventarioMetrics.totalUnidades.toLocaleString("es-PY")} unidades
          </p>
        </div>

        {/* Stock críticos arriba si los hay */}
        {inventarioMetrics.critico > 0 && (
          <Link
            href="/inventario"
            className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl p-3 active:bg-red-100 transition-colors"
          >
            <div className="shrink-0 w-9 h-9 rounded-full bg-red-100 flex items-center justify-center">
              <AlertTriangle className="h-5 w-5 text-red-700" aria-hidden />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-900">
                {inventarioMetrics.critico} producto{inventarioMetrics.critico === 1 ? "" : "s"} sin stock
              </p>
              <p className="text-[11px] text-red-700 mt-0.5">Tocá para reponer</p>
            </div>
            <ChevronRight className="h-5 w-5 text-red-600 shrink-0" aria-hidden />
          </Link>
        )}

        {/* Estado del stock: 3 KPIs */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2 px-1">
            Estado del stock
          </p>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white rounded-xl border border-emerald-200 p-3 shadow-sm">
              <p className="text-[9px] font-bold uppercase tracking-wider text-emerald-700">Saludable</p>
              <p className="text-xl font-bold text-emerald-700 tabular-nums mt-1">{inventarioMetrics.saludable}</p>
            </div>
            <div className="bg-white rounded-xl border border-amber-200 p-3 shadow-sm">
              <p className="text-[9px] font-bold uppercase tracking-wider text-amber-700">Bajo</p>
              <p className="text-xl font-bold text-amber-700 tabular-nums mt-1">{inventarioMetrics.bajo}</p>
            </div>
            <div className="bg-white rounded-xl border border-red-200 p-3 shadow-sm">
              <p className="text-[9px] font-bold uppercase tracking-wider text-red-700">Sin stock</p>
              <p className="text-xl font-bold text-red-700 tabular-nums mt-1">{inventarioMetrics.critico}</p>
            </div>
          </div>
        </div>

        {/* Acciones rápidas inventario */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2 px-1">
            Acciones
          </p>
          <div className="grid grid-cols-2 gap-3">
            <QuickAction href="/inventario/nuevo" icon={Plus} label="Nuevo producto" color="emerald" />
            <QuickAction href="/inventario/movimientos/nuevo" icon={Package} label="Movimiento" color="sky" />
          </div>
        </div>

        {/* Productos críticos (top 5 que más necesitan reposición) */}
        {productosCriticos.length > 0 ? (
          <div>
            <div className="flex items-center justify-between mb-2 px-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Necesitan reposición
              </p>
              <Link href="/inventario" className="text-[11px] font-medium text-[#4FAEB2] active:underline">
                Ver todos →
              </Link>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 shadow-sm">
              {productosCriticos.map((p) => {
                const actual = Number(p.stock_actual ?? 0);
                const minimo = Number(p.stock_minimo ?? 0);
                const sinStock = actual <= 0;
                return (
                  <Link
                    key={String(p.id)}
                    href={`/inventario/${p.id}/editar`}
                    className="flex items-center justify-between gap-3 px-4 py-3 active:bg-slate-50 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900 truncate">{p.nombre}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5 font-mono">{p.sku}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-bold tabular-nums ${sinStock ? "text-red-700" : "text-amber-700"}`}>
                        {actual} / {minimo}
                      </p>
                      <p className="text-[10px] text-slate-500 mt-0.5">actual / mín</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="text-center py-6 px-4 bg-emerald-50 rounded-xl border border-dashed border-emerald-300">
            <p className="text-sm font-medium text-emerald-800">✓ Todo el stock está saludable</p>
            <p className="text-[11px] text-emerald-700 mt-1">No hay productos por reponer</p>
          </div>
        )}
      </>
      )}
    </div>
  );
}

// ── Sub-componentes ──────────────────────────────────────────────────────

function QuickAction({
  href,
  icon: Icon,
  label,
  color,
}: {
  href: string;
  icon: typeof ShoppingCart;
  label: string;
  color: "emerald" | "sky" | "violet" | "amber";
}) {
  const colorClasses = {
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-900 active:bg-emerald-100",
    sky: "bg-sky-50 border-sky-200 text-sky-900 active:bg-sky-100",
    violet: "bg-violet-50 border-violet-200 text-violet-900 active:bg-violet-100",
    amber: "bg-amber-50 border-amber-200 text-amber-900 active:bg-amber-100",
  }[color];
  const iconColor = {
    emerald: "text-emerald-700",
    sky: "text-sky-700",
    violet: "text-violet-700",
    amber: "text-amber-700",
  }[color];

  return (
    <Link
      href={href}
      className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border p-4 min-h-[88px] shadow-sm transition-colors ${colorClasses}`}
    >
      <Icon className={`h-6 w-6 ${iconColor}`} aria-hidden />
      <span className="text-xs font-semibold text-center leading-tight">{label}</span>
    </Link>
  );
}

function SummaryRow({
  label,
  value,
  sub,
  highlight,
  negative,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
  negative?: boolean;
}) {
  const valueColor = negative
    ? "text-red-700"
    : highlight
      ? "text-emerald-700"
      : "text-slate-900";
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm text-slate-700">{label}</p>
        {sub && <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>}
      </div>
      <p className={`text-sm font-bold tabular-nums shrink-0 ${valueColor}`}>{value}</p>
    </div>
  );
}

/**
 * Tab del selector de sección (Inicio / Financiero / Inventario).
 * Estilo segmented control: el activo tiene fondo blanco con shadow.
 */
function SectionTab({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof HomeIcon;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-0.5 py-2 rounded-lg text-[11px] font-semibold transition-all min-h-[44px] ${
        active
          ? "bg-white text-[#4FAEB2] shadow-sm"
          : "text-slate-600 active:bg-slate-200/60"
      }`}
      aria-pressed={active}
    >
      <Icon className="h-4 w-4" aria-hidden />
      <span>{label}</span>
    </button>
  );
}
