/**
 * Helpers server-side para el modulo Caja (1 sola caja por empresa).
 */
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import type {
  Caja,
  CajaDetalle,
  CajaDetalleVenta,
  CajaDetalleMovimiento,
  CajaMovimiento,
  CajaResumen,
  CajaReporteRow,
  CajasReporte,
  EstadoCaja,
  MedioPagoCaja,
  TipoMovimientoCaja,
} from "./types";
import { calcularTotalArqueo, type ArqueoItem } from "./denominaciones";
import { applyTokenSearch } from "@/lib/productos/token-search";

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

const CAJA_COLS =
  "id, numero_caja, estado, abierta_por, cerrada_por, fecha_apertura, fecha_cierre, " +
  "monto_apertura, monto_cierre_contado, monto_esperado_efectivo, diferencia, " +
  "observacion_apertura, observacion_cierre, arqueo_apertura_json, arqueo_cierre_json";

interface CajaRow {
  id: string;
  numero_caja: number | string;
  estado: string;
  abierta_por: string | null;
  cerrada_por: string | null;
  fecha_apertura: string;
  fecha_cierre: string | null;
  monto_apertura: number | string;
  monto_cierre_contado: number | string | null;
  monto_esperado_efectivo: number | string | null;
  diferencia: number | string | null;
  observacion_apertura: string | null;
  observacion_cierre: string | null;
  arqueo_apertura_json: ArqueoItem[] | null;
  arqueo_cierre_json: ArqueoItem[] | null;
}

/** Normaliza el estado del turno a uno de los 3 válidos. */
function estadoCaja(v: string): EstadoCaja {
  return v === "cerrada" ? "cerrada" : v === "en_cierre" ? "en_cierre" : "abierta";
}

function mapCaja(r: CajaRow): Caja {
  return {
    id: r.id,
    numero_caja: num(r.numero_caja) || 1,
    estado: estadoCaja(r.estado),
    abierta_por: r.abierta_por,
    cerrada_por: r.cerrada_por,
    fecha_apertura: r.fecha_apertura,
    fecha_cierre: r.fecha_cierre,
    monto_apertura: num(r.monto_apertura),
    monto_cierre_contado:
      r.monto_cierre_contado == null ? null : num(r.monto_cierre_contado),
    monto_esperado_efectivo:
      r.monto_esperado_efectivo == null ? null : num(r.monto_esperado_efectivo),
    diferencia: r.diferencia == null ? null : num(r.diferencia),
    observacion_apertura: r.observacion_apertura,
    observacion_cierre: r.observacion_cierre,
    arqueo_apertura_json: r.arqueo_apertura_json ?? null,
    arqueo_cierre_json: r.arqueo_cierre_json ?? null,
  };
}

/** Devuelve la caja abierta actual de la empresa (o null). */
export async function getCajaAbierta(
  sb: AppSupabaseClient,
  empresaId: string
): Promise<Caja | null> {
  const q = await sb
    .from("cajas")
    .select(CAJA_COLS)
    .eq("empresa_id", empresaId)
    .eq("estado", "abierta")
    .order("fecha_apertura", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (q.error) throw new Error(q.error.message);
  return q.data ? mapCaja(q.data as unknown as CajaRow) : null;
}

/** Cajas ACTIVAS (abiertas o en cierre/conteo) de la empresa, por número. */
export async function listarCajasActivas(
  sb: AppSupabaseClient,
  empresaId: string
): Promise<Caja[]> {
  const q = await sb
    .from("cajas")
    .select(CAJA_COLS)
    .eq("empresa_id", empresaId)
    .in("estado", ["abierta", "en_cierre"])
    .order("numero_caja", { ascending: true });
  if (q.error) throw new Error(q.error.message);
  return ((q.data ?? []) as unknown as CajaRow[]).map(mapCaja);
}

/** Estado de todas las cajas activas (abiertas/en_cierre) con su resumen/arqueo en vivo. */
export async function getEstadoCajas(
  sb: AppSupabaseClient,
  empresaId: string
): Promise<CajaResumen[]> {
  const cajas = await listarCajasActivas(sb, empresaId);
  const resumenes = await Promise.all(cajas.map((c) => computeResumen(sb, empresaId, c)));
  return resumenes;
}

/** Números de caja actualmente activos (para asignar el próximo libre). */
async function numerosActivos(sb: AppSupabaseClient, empresaId: string): Promise<number[]> {
  const q = await sb
    .from("cajas")
    .select("numero_caja")
    .eq("empresa_id", empresaId)
    .in("estado", ["abierta", "en_cierre"]);
  if (q.error) throw new Error(q.error.message);
  return ((q.data ?? []) as Array<{ numero_caja: number | string }>).map((r) => num(r.numero_caja) || 1);
}

/** Historial de cajas (mas reciente primero). */
export async function listarCajas(
  sb: AppSupabaseClient,
  empresaId: string,
  limit = 50
): Promise<Caja[]> {
  const q = await sb
    .from("cajas")
    .select(CAJA_COLS)
    .eq("empresa_id", empresaId)
    .order("fecha_apertura", { ascending: false })
    .limit(limit);
  if (q.error) throw new Error(q.error.message);
  return ((q.data ?? []) as unknown as CajaRow[]).map(mapCaja);
}

/**
 * Reporte de cierres de caja por rango de fechas (turnos abiertos en el
 * rango). Agrega ventas y movimientos en lote (2 queries totales, sin N+1)
 * y resuelve los nombres de quien abrio/cerro cada turno.
 */
export async function getReporteCajas(
  sb: AppSupabaseClient,
  empresaId: string,
  rango: { start: string; end: string; desde: string; hasta: string }
): Promise<CajasReporte> {
  // 1) Cajas cuyo turno abrio dentro del rango.
  const cQ = await sb
    .from("cajas")
    .select(CAJA_COLS)
    .eq("empresa_id", empresaId)
    .gte("fecha_apertura", rango.start)
    .lte("fecha_apertura", rango.end)
    .order("fecha_apertura", { ascending: false });
  if (cQ.error) throw new Error(cQ.error.message);
  const cajas = ((cQ.data ?? []) as unknown as CajaRow[]).map(mapCaja);

  const empty: CajasReporte = {
    desde: rango.desde,
    hasta: rango.hasta,
    totales: {
      cantidad_cajas: 0,
      cajas_abiertas: 0,
      cajas_cerradas: 0,
      total_vendido: 0,
      total_efectivo: 0,
      total_tarjeta: 0,
      total_transferencia: 0,
      total_diferencia: 0,
      faltantes: 0,
      sobrantes: 0,
      cajas_con_diferencia: 0,
    },
    cajas: [],
  };
  if (cajas.length === 0) return empty;

  const cajaIds = cajas.map((c) => c.id);

  // 2) Ventas de esas cajas (en lote).
  const vQ = await sb
    .from("ventas")
    .select("id, caja_id, total, metodo_pago, tipo_venta, estado")
    .eq("empresa_id", empresaId)
    .in("caja_id", cajaIds);
  if (vQ.error) throw new Error(vQ.error.message);
  const ventas = (vQ.data ?? []) as unknown as Array<{
    id: string;
    caja_id: string | null;
    total: number | string;
    metodo_pago: string | null;
    tipo_venta: string | null;
    estado: string | null;
  }>;

  // 2b) Desglose por metodo desde ventas_pagos_detalle (pago mixto).
  //     Solo lo cargamos para las ventas de estos turnos.
  const ventaIds = ventas.map((v) => v.id);
  type PagosBreakdown = { efectivo: number; tarjeta: number; transferencia: number };
  const pagosByVenta = new Map<string, PagosBreakdown>();
  if (ventaIds.length > 0) {
    const pdQ = await sb
      .from("ventas_pagos_detalle")
      .select("venta_id, metodo_pago, monto")
      .eq("empresa_id", empresaId)
      .in("venta_id", ventaIds);
    if (!pdQ.error) {
      const rows = (pdQ.data ?? []) as unknown as Array<{
        venta_id: string;
        metodo_pago: string | null;
        monto: number | string;
      }>;
      for (const r of rows) {
        let b = pagosByVenta.get(r.venta_id);
        if (!b) {
          b = { efectivo: 0, tarjeta: 0, transferencia: 0 };
          pagosByVenta.set(r.venta_id, b);
        }
        const monto = num(r.monto);
        if (r.metodo_pago === "tarjeta") b.tarjeta += monto;
        else if (r.metodo_pago === "transferencia") b.transferencia += monto;
        else b.efectivo += monto;
      }
    }
  }

  // 3) Movimientos activos de esas cajas (en lote).
  const mQ = await sb
    .from("caja_movimientos")
    .select("caja_id, tipo, monto, medio_pago, venta_id")
    .eq("empresa_id", empresaId)
    .in("caja_id", cajaIds)
    .is("anulado_at", null);
  if (mQ.error) throw new Error(mQ.error.message);
  const movs = (mQ.data ?? []) as unknown as Array<{
    caja_id: string | null;
    tipo: string;
    monto: number | string;
    medio_pago: string | null;
    venta_id: string | null;
  }>;

  // 4) Nombres de usuarios (abierta_por / cerrada_por).
  const userIds = [
    ...new Set(
      cajas.flatMap((c) => [c.abierta_por, c.cerrada_por]).filter((x): x is string => !!x)
    ),
  ];
  const nombrePorUsuario = new Map<string, string>();
  if (userIds.length > 0) {
    const uQ = await sb
      .from("usuarios")
      .select("id, nombre, email")
      .eq("empresa_id", empresaId)
      .in("id", userIds);
    if (!uQ.error) {
      for (const u of (uQ.data ?? []) as Array<{ id: string; nombre: string | null; email: string | null }>) {
        nombrePorUsuario.set(u.id, (u.nombre?.trim() || u.email?.trim() || "—") as string);
      }
    }
  }

  // 5) Acumuladores por caja.
  type Acc = {
    cantidad_ventas: number;
    total_vendido: number;
    total_efectivo: number;
    total_tarjeta: number;
    total_transferencia: number;
    ingresos_efectivo: number;
    egresos_efectivo: number;
    retiros_efectivo: number;
    ajustes_efectivo: number;
  };
  const accById = new Map<string, Acc>();
  const newAcc = (): Acc => ({
    cantidad_ventas: 0,
    total_vendido: 0,
    total_efectivo: 0,
    total_tarjeta: 0,
    total_transferencia: 0,
    ingresos_efectivo: 0,
    egresos_efectivo: 0,
    retiros_efectivo: 0,
    ajustes_efectivo: 0,
  });
  for (const id of cajaIds) accById.set(id, newAcc());

  // Ventas totalmente devueltas: se excluyen del reporte junto con su caja_movimiento
  // asociado (via venta_id) para que EFECTIVO y ESPERADO reflejen el neto real.
  const ventasDevueltas = new Set(
    ventas.filter((v) => v.estado === "devuelta_total").map((v) => v.id)
  );

  for (const v of ventas) {
    if (!v.caja_id || v.estado === "anulada" || v.estado === "devuelta_total") continue;
    const a = accById.get(v.caja_id);
    if (!a) continue;
    const t = num(v.total);
    a.cantidad_ventas++;
    a.total_vendido += t;
    // Ventas a credito: NO entra plata a caja al momento de la venta.
    // Se cuentan en total_vendido pero no en ningun medio de pago.
    // El cobro efectivo llega despues via cobros_clientes.
    if ((v.tipo_venta ?? "").toLowerCase() === "credito") continue;
    // Si es mixto (o hay pagos_detalle registrados), usar el desglose real.
    const bk = pagosByVenta.get(v.id);
    if (v.metodo_pago === "mixto" && bk) {
      a.total_efectivo += bk.efectivo;
      a.total_tarjeta += bk.tarjeta;
      a.total_transferencia += bk.transferencia;
    } else if (v.metodo_pago === "tarjeta") a.total_tarjeta += t;
    else if (v.metodo_pago === "transferencia") a.total_transferencia += t;
    else a.total_efectivo += t;
  }

  for (const m of movs) {
    if (!m.caja_id) continue;
    // Si es reembolso/diferencia de una venta que ya excluimos por devuelta_total, saltarlo.
    if (m.venta_id && ventasDevueltas.has(m.venta_id)) continue;
    const a = accById.get(m.caja_id);
    if (!a) continue;
    if ((m.medio_pago ?? "efectivo") !== "efectivo") continue;
    const monto = num(m.monto);
    if (m.tipo === "ingreso") a.ingresos_efectivo += monto;
    else if (m.tipo === "egreso") a.egresos_efectivo += monto;
    else if (m.tipo === "retiro") a.retiros_efectivo += monto;
    else if (m.tipo === "ajuste") a.ajustes_efectivo += monto;
  }

  // 6) Filas + totales.
  const filas: CajaReporteRow[] = cajas.map((c) => {
    const a = accById.get(c.id) ?? newAcc();
    const efectivoEsperado =
      c.monto_apertura +
      a.total_efectivo +
      a.ingresos_efectivo -
      a.egresos_efectivo -
      a.retiros_efectivo +
      a.ajustes_efectivo;
    return {
      id: c.id,
      numero_caja: c.numero_caja,
      estado: c.estado,
      fecha_apertura: c.fecha_apertura,
      fecha_cierre: c.fecha_cierre,
      abierta_por_nombre: c.abierta_por ? nombrePorUsuario.get(c.abierta_por) ?? null : null,
      cerrada_por_nombre: c.cerrada_por ? nombrePorUsuario.get(c.cerrada_por) ?? null : null,
      monto_apertura: c.monto_apertura,
      cantidad_ventas: a.cantidad_ventas,
      total_vendido: a.total_vendido,
      total_efectivo: a.total_efectivo,
      total_tarjeta: a.total_tarjeta,
      total_transferencia: a.total_transferencia,
      ingresos_efectivo: a.ingresos_efectivo,
      egresos_efectivo: a.egresos_efectivo,
      retiros_efectivo: a.retiros_efectivo,
      ajustes_efectivo: a.ajustes_efectivo,
      efectivo_esperado: efectivoEsperado,
      monto_esperado_efectivo: c.monto_esperado_efectivo,
      monto_cierre_contado: c.monto_cierre_contado,
      diferencia: c.diferencia,
      observacion_cierre: c.observacion_cierre,
      arqueo_apertura_json: c.arqueo_apertura_json,
      arqueo_cierre_json: c.arqueo_cierre_json,
    };
  });

  const totales = empty.totales;
  totales.cantidad_cajas = filas.length;
  for (const f of filas) {
    if (f.estado === "cerrada") totales.cajas_cerradas++;
    else totales.cajas_abiertas++;
    totales.total_vendido += f.total_vendido;
    totales.total_efectivo += f.total_efectivo;
    totales.total_tarjeta += f.total_tarjeta;
    totales.total_transferencia += f.total_transferencia;
    if (f.diferencia != null && f.diferencia !== 0) {
      totales.cajas_con_diferencia++;
      totales.total_diferencia += f.diferencia;
      if (f.diferencia < 0) totales.faltantes += -f.diferencia;
      else totales.sobrantes += f.diferencia;
    }
  }

  return { desde: rango.desde, hasta: rango.hasta, totales, cajas: filas };
}

/**
 * Detalle de UN turno de caja para el reporte: cabecera agregada (misma forma
 * que una fila de getReporteCajas) + las ventas y movimientos manuales
 * individuales realizados durante el turno (para el "Ver detalles").
 */
export async function getDetalleCaja(
  sb: AppSupabaseClient,
  empresaId: string,
  cajaId: string
): Promise<CajaDetalle | null> {
  const cQ = await sb
    .from("cajas")
    .select(CAJA_COLS)
    .eq("empresa_id", empresaId)
    .eq("id", cajaId)
    .maybeSingle();
  if (cQ.error) throw new Error(cQ.error.message);
  if (!cQ.data) return null;
  const caja = mapCaja(cQ.data as unknown as CajaRow);

  // Ventas individuales del turno (cronológico).
  const vQ = await sb
    .from("ventas")
    .select("id, numero_control, fecha, metodo_pago, tipo_venta, total, estado, usuario_nombre")
    .eq("empresa_id", empresaId)
    .eq("caja_id", cajaId)
    .order("fecha", { ascending: true });
  if (vQ.error) throw new Error(vQ.error.message);
  const ventasRaw = (vQ.data ?? []) as unknown as Array<{
    id: string;
    numero_control: string | null;
    fecha: string;
    metodo_pago: string | null;
    tipo_venta: string | null;
    total: number | string;
    estado: string | null;
    usuario_nombre: string | null;
  }>;
  const ventas: CajaDetalleVenta[] = ventasRaw.map((v) => ({
    id: v.id,
    numero_control: v.numero_control,
    fecha: v.fecha,
    metodo_pago: (v.metodo_pago ?? "efectivo") as MedioPagoCaja,
    tipo_venta: v.tipo_venta,
    total: num(v.total),
    estado: v.estado,
    usuario_nombre: v.usuario_nombre,
    desglose_pago: null, // se rellena mas abajo cuando la venta es mixto
  }));

  // Movimientos manuales activos del turno (cronológico).
  const mQ = await sb
    .from("caja_movimientos")
    .select(
      "id, caja_id, tipo, concepto, monto, medio_pago, usuario_id, usuario_email, observacion, created_at, venta_id"
    )
    .eq("empresa_id", empresaId)
    .eq("caja_id", cajaId)
    .is("anulado_at", null)
    .order("created_at", { ascending: true });
  if (mQ.error) throw new Error(mQ.error.message);
  const movsRaw = (mQ.data ?? []) as unknown as Array<{
    id: string;
    caja_id: string;
    tipo: string;
    concepto: string;
    monto: number | string;
    medio_pago: string | null;
    usuario_id: string | null;
    usuario_email: string | null;
    observacion: string | null;
    created_at: string;
    venta_id: string | null;
  }>;
  const ventasDevueltasSet = new Set(
    ventas.filter((v) => v.estado === "devuelta_total").map((v) => v.id)
  );
  // Filtramos aca los movimientos que son reembolso/diferencia de una venta devuelta_total:
  // no deben contarse (la venta tampoco se cuenta) y no deben aparecer en la linea de tiempo.
  const movs = movsRaw.filter((m) => !(m.venta_id && ventasDevueltasSet.has(m.venta_id)));

  // Desglose por metodo desde ventas_pagos_detalle (para pago mixto).
  const detalleIds = ventas.map((v) => v.id);
  const detallePagos = new Map<string, { efectivo: number; tarjeta: number; transferencia: number }>();
  if (detalleIds.length > 0) {
    const pdQ = await sb
      .from("ventas_pagos_detalle")
      .select("venta_id, metodo_pago, monto")
      .eq("empresa_id", empresaId)
      .in("venta_id", detalleIds);
    if (!pdQ.error) {
      for (const r of (pdQ.data ?? []) as Array<{ venta_id: string; metodo_pago: string | null; monto: number | string }>) {
        let b = detallePagos.get(r.venta_id);
        if (!b) { b = { efectivo: 0, tarjeta: 0, transferencia: 0 }; detallePagos.set(r.venta_id, b); }
        const monto = num(r.monto);
        if (r.metodo_pago === "tarjeta") b.tarjeta += monto;
        else if (r.metodo_pago === "transferencia") b.transferencia += monto;
        else b.efectivo += monto;
      }
    }
  }
  // Anexar el desglose a cada venta mixta para que el cliente lo pueda mostrar.
  for (const v of ventas) {
    if (v.metodo_pago === "mixto") {
      v.desglose_pago = detallePagos.get(v.id) ?? null;
    }
  }

  // Acumuladores para la cabecera (misma lógica que getReporteCajas).
  let cantidadVentas = 0,
    totalVendido = 0,
    totalEfectivo = 0,
    totalTarjeta = 0,
    totalTransferencia = 0;
  for (const v of ventas) {
    if (v.estado === "anulada" || v.estado === "devuelta_total") continue;
    cantidadVentas++;
    totalVendido += v.total;
    // Ventas a credito: no impactan la caja hasta que se cobren via cobros_clientes.
    if ((v.tipo_venta ?? "").toLowerCase() === "credito") continue;
    const bk = detallePagos.get(v.id);
    if (v.metodo_pago === "mixto" && bk) {
      totalEfectivo += bk.efectivo;
      totalTarjeta += bk.tarjeta;
      totalTransferencia += bk.transferencia;
    } else if (v.metodo_pago === "tarjeta") totalTarjeta += v.total;
    else if (v.metodo_pago === "transferencia") totalTransferencia += v.total;
    else totalEfectivo += v.total;
  }
  let ingresosEf = 0,
    egresosEf = 0,
    retirosEf = 0,
    ajustesEf = 0;
  for (const m of movs) {
    if ((m.medio_pago ?? "efectivo") !== "efectivo") continue;
    const monto = num(m.monto);
    if (m.tipo === "ingreso") ingresosEf += monto;
    else if (m.tipo === "egreso") egresosEf += monto;
    else if (m.tipo === "retiro") retirosEf += monto;
    else if (m.tipo === "ajuste") ajustesEf += monto;
  }
  const efectivoEsperado =
    caja.monto_apertura +
    totalEfectivo +
    ingresosEf -
    egresosEf -
    retirosEf +
    ajustesEf;

  // Nombres de usuarios (quién abrió/cerró + autores de movimientos).
  const userIds = [
    ...new Set(
      [caja.abierta_por, caja.cerrada_por, ...movsRaw.map((m) => m.usuario_id)].filter(
        (x): x is string => !!x
      )
    ),
  ];
  const nombrePorUsuario = new Map<string, string>();
  if (userIds.length > 0) {
    const uQ = await sb
      .from("usuarios")
      .select("id, nombre, email")
      .eq("empresa_id", empresaId)
      .in("id", userIds);
    if (!uQ.error) {
      for (const u of (uQ.data ?? []) as Array<{ id: string; nombre: string | null; email: string | null }>) {
        nombrePorUsuario.set(u.id, (u.nombre?.trim() || u.email?.trim() || "—") as string);
      }
    }
  }

  // Timeline muestra TODOS los movimientos (para auditoria); los totales ya excluyen los de devuelta_total.
  const movimientos: CajaDetalleMovimiento[] = movsRaw.map((m) => ({
    id: m.id,
    caja_id: m.caja_id,
    tipo: m.tipo as TipoMovimientoCaja,
    concepto: m.concepto,
    monto: num(m.monto),
    medio_pago: (m.medio_pago ?? "efectivo") as MedioPagoCaja,
    usuario_id: m.usuario_id,
    observacion: m.observacion,
    created_at: m.created_at,
    usuario_email: m.usuario_email,
    usuario_nombre: m.usuario_id ? nombrePorUsuario.get(m.usuario_id) ?? null : null,
  }));

  const row: CajaReporteRow = {
    id: caja.id,
    numero_caja: caja.numero_caja,
    estado: caja.estado,
    fecha_apertura: caja.fecha_apertura,
    fecha_cierre: caja.fecha_cierre,
    abierta_por_nombre: caja.abierta_por ? nombrePorUsuario.get(caja.abierta_por) ?? null : null,
    cerrada_por_nombre: caja.cerrada_por ? nombrePorUsuario.get(caja.cerrada_por) ?? null : null,
    monto_apertura: caja.monto_apertura,
    cantidad_ventas: cantidadVentas,
    total_vendido: totalVendido,
    total_efectivo: totalEfectivo,
    total_tarjeta: totalTarjeta,
    total_transferencia: totalTransferencia,
    ingresos_efectivo: ingresosEf,
    egresos_efectivo: egresosEf,
    retiros_efectivo: retirosEf,
    ajustes_efectivo: ajustesEf,
    efectivo_esperado: efectivoEsperado,
    monto_esperado_efectivo: caja.monto_esperado_efectivo,
    monto_cierre_contado: caja.monto_cierre_contado,
    diferencia: caja.diferencia,
    observacion_cierre: caja.observacion_cierre,
    arqueo_apertura_json: caja.arqueo_apertura_json,
    arqueo_cierre_json: caja.arqueo_cierre_json,
  };

  return { caja: row, ventas, movimientos };
}

/** Resumen/arqueo de UNA caja (ventas + movs + efectivo esperado). */
export async function getResumenCaja(
  sb: AppSupabaseClient,
  empresaId: string,
  cajaId: string
): Promise<CajaResumen | null> {
  const q = await sb
    .from("cajas")
    .select(CAJA_COLS)
    .eq("empresa_id", empresaId)
    .eq("id", cajaId)
    .maybeSingle();
  if (q.error) throw new Error(q.error.message);
  if (!q.data) return null;
  return await computeResumen(sb, empresaId, mapCaja(q.data as unknown as CajaRow));
}

/**
 * Abre una nueva caja (turno). Permite MULTIPLES cajas activas: cada una con su
 * `numero_caja`. El índice único parcial en DB garantiza que no haya dos turnos
 * activos (abierta/en_cierre) sobre el mismo número. Si no se pasa número, se
 * asigna el más bajo libre (1, 2, …).
 */
export async function abrirCaja(
  sb: AppSupabaseClient,
  params: {
    empresaId: string;
    montoApertura: number;
    observacion: string | null;
    usuarioId: string | null;
    numeroCaja?: number | null;
    /**
     * Detalle del conteo físico (monedas/billetes). Si viene (incluso con
     * total 0), el saldo inicial se CALCULA desde acá — el monto manual se
     * ignora — y se persiste el detalle para auditoría. Si es null/undefined,
     * se usa `montoApertura` tal cual (flujo manual de siempre).
     */
    arqueoApertura?: ArqueoItem[] | null;
  }
): Promise<Caja> {
  const activos = await numerosActivos(sb, params.empresaId);
  let numero = params.numeroCaja ?? null;
  if (numero != null) {
    if (activos.includes(numero)) {
      throw new Error(`La Caja ${numero} ya está activa. Cerrala antes de reabrir ese número.`);
    }
  } else {
    numero = 1;
    while (activos.includes(numero)) numero++;
  }

  const usaArqueo = params.arqueoApertura != null;
  const montoFinal = usaArqueo ? calcularTotalArqueo(params.arqueoApertura!) : params.montoApertura;

  const ins = await sb
    .from("cajas")
    .insert({
      empresa_id: params.empresaId,
      numero_caja: numero,
      estado: "abierta",
      abierta_por: params.usuarioId,
      monto_apertura: Math.round(montoFinal),
      observacion_apertura: params.observacion,
      arqueo_apertura_json: usaArqueo ? params.arqueoApertura : null,
    })
    .select(CAJA_COLS)
    .single();
  if (ins.error) {
    if (/duplicate|23505/i.test(ins.error.message)) {
      throw new Error(`La Caja ${numero} ya está activa. Cerrala antes de reabrir ese número.`);
    }
    throw new Error(ins.error.message);
  }
  return mapCaja(ins.data as unknown as CajaRow);
}

/** Pasa una caja abierta a estado 'en_cierre' (conteo): deja de recibir ventas/movimientos. */
export async function ponerCajaEnCierre(
  sb: AppSupabaseClient,
  empresaId: string,
  cajaId: string
): Promise<Caja> {
  const upd = await sb
    .from("cajas")
    .update({ estado: "en_cierre", updated_at: new Date().toISOString() })
    .eq("empresa_id", empresaId)
    .eq("id", cajaId)
    .eq("estado", "abierta")
    .select(CAJA_COLS)
    .maybeSingle();
  if (upd.error) throw new Error(upd.error.message);
  if (!upd.data) throw new Error("La caja no está abierta.");
  return mapCaja(upd.data as unknown as CajaRow);
}

/** Cierra la caja (turno): calcula esperado + diferencia y persiste el arqueo.
 *  Cierra tanto desde 'abierta' como desde 'en_cierre'. */
export async function cerrarCaja(
  sb: AppSupabaseClient,
  params: {
    empresaId: string;
    cajaId: string;
    montoCierreContado: number;
    observacion: string | null;
    usuarioId: string | null;
    /**
     * Detalle del conteo físico al cerrar. Si viene, el saldo contado se
     * CALCULA desde acá (el monto manual se ignora) y se persiste el
     * detalle. Si es null/undefined, se usa `montoCierreContado` tal cual.
     */
    arqueoCierre?: ArqueoItem[] | null;
  }
): Promise<CajaResumen> {
  const resumen = await getResumenCaja(sb, params.empresaId, params.cajaId);
  if (!resumen) throw new Error("Caja no encontrada.");
  if (resumen.caja.estado === "cerrada") {
    throw new Error("La caja ya está cerrada.");
  }
  const usaArqueo = params.arqueoCierre != null;
  const contado = Math.round(usaArqueo ? calcularTotalArqueo(params.arqueoCierre!) : params.montoCierreContado);
  const esperado = Math.round(resumen.efectivo_esperado);
  const diferencia = contado - esperado;

  const upd = await sb
    .from("cajas")
    .update({
      estado: "cerrada",
      cerrada_por: params.usuarioId,
      fecha_cierre: new Date().toISOString(),
      monto_cierre_contado: contado,
      monto_esperado_efectivo: esperado,
      diferencia,
      observacion_cierre: params.observacion,
      arqueo_cierre_json: usaArqueo ? params.arqueoCierre : null,
    })
    .eq("empresa_id", params.empresaId)
    .eq("id", params.cajaId)
    .in("estado", ["abierta", "en_cierre"])
    .select(CAJA_COLS)
    .single();
  if (upd.error) throw new Error(upd.error.message);

  return {
    ...resumen,
    caja: mapCaja(upd.data as unknown as CajaRow),
    efectivo_esperado: esperado,
  };
}

/** Registra un movimiento manual en la caja abierta. */
export async function registrarMovimiento(
  sb: AppSupabaseClient,
  params: {
    empresaId: string;
    cajaId: string;
    tipo: TipoMovimientoCaja;
    concepto: string;
    monto: number;
    medioPago: MedioPagoCaja;
    observacion: string | null;
    usuarioId: string | null;
    /** Email snapshot del usuario (para listados sin JOIN). Opcional. */
    usuarioEmail?: string | null;
  }
): Promise<CajaMovimiento> {
  const cQ = await sb
    .from("cajas")
    .select("id, estado")
    .eq("empresa_id", params.empresaId)
    .eq("id", params.cajaId)
    .maybeSingle();
  if (cQ.error) throw new Error(cQ.error.message);
  if (!cQ.data) throw new Error("Caja no encontrada.");
  if ((cQ.data as { estado: string }).estado !== "abierta") {
    throw new Error("La caja no está abierta; no se pueden registrar movimientos.");
  }

  const ins = await sb
    .from("caja_movimientos")
    .insert({
      empresa_id: params.empresaId,
      caja_id: params.cajaId,
      tipo: params.tipo,
      concepto: params.concepto.trim(),
      monto: Math.round(params.monto),
      medio_pago: params.medioPago,
      usuario_id: params.usuarioId,
      usuario_email: params.usuarioEmail ?? null,
      observacion: params.observacion,
    })
    .select(
      "id, caja_id, tipo, concepto, monto, medio_pago, usuario_id, observacion, created_at"
    )
    .single();
  if (ins.error) throw new Error(ins.error.message);
  const m = ins.data as unknown as {
    id: string;
    caja_id: string;
    tipo: string;
    concepto: string;
    monto: number | string;
    medio_pago: string | null;
    usuario_id: string | null;
    observacion: string | null;
    created_at: string;
  };
  return {
    id: m.id,
    caja_id: m.caja_id,
    tipo: m.tipo as TipoMovimientoCaja,
    concepto: m.concepto,
    monto: num(m.monto),
    medio_pago: (m.medio_pago ?? "efectivo") as MedioPagoCaja,
    usuario_id: m.usuario_id,
    observacion: m.observacion,
    created_at: m.created_at,
  };
}

// ============================================================
// Internos
// ============================================================

async function computeResumen(
  sb: AppSupabaseClient,
  empresaId: string,
  caja: Caja
): Promise<CajaResumen> {
  // Ventas asociadas (excluye anuladas si la columna estado existe).
  const vQ = await sb
    .from("ventas")
    .select("id, total, metodo_pago, tipo_venta, estado")
    .eq("empresa_id", empresaId)
    .eq("caja_id", caja.id);
  if (vQ.error) throw new Error(vQ.error.message);
  const ventas = (vQ.data ?? []) as unknown as Array<{
    id: string;
    total: number | string;
    metodo_pago: string | null;
    tipo_venta: string | null;
    estado: string | null;
  }>;

  // Desglose por metodo desde ventas_pagos_detalle (pago mixto).
  const ventaIdsR = ventas.map((v) => v.id);
  const detalleByVenta = new Map<string, { efectivo: number; tarjeta: number; transferencia: number }>();
  if (ventaIdsR.length > 0) {
    const pdQ = await sb
      .from("ventas_pagos_detalle")
      .select("venta_id, metodo_pago, monto")
      .eq("empresa_id", empresaId)
      .in("venta_id", ventaIdsR);
    if (!pdQ.error) {
      for (const r of (pdQ.data ?? []) as Array<{ venta_id: string; metodo_pago: string | null; monto: number | string }>) {
        let b = detalleByVenta.get(r.venta_id);
        if (!b) { b = { efectivo: 0, tarjeta: 0, transferencia: 0 }; detalleByVenta.set(r.venta_id, b); }
        const monto = num(r.monto);
        if (r.metodo_pago === "tarjeta") b.tarjeta += monto;
        else if (r.metodo_pago === "transferencia") b.transferencia += monto;
        else b.efectivo += monto;
      }
    }
  }

  let totalVendido = 0;
  let totalEfectivo = 0;
  let totalTarjeta = 0;
  let totalTransferencia = 0;
  let count = 0;
  for (const v of ventas) {
    if (v.estado === "anulada") continue;
    count++;
    const t = num(v.total);
    totalVendido += t;
    // Ventas a credito: se cuentan en total_vendido pero no en ningun medio de pago
    // (el cobro efectivo llega despues via cobros_clientes).
    if ((v.tipo_venta ?? "").toLowerCase() === "credito") continue;
    const bk = detalleByVenta.get(v.id);
    if (v.metodo_pago === "mixto" && bk) {
      totalEfectivo += bk.efectivo;
      totalTarjeta += bk.tarjeta;
      totalTransferencia += bk.transferencia;
    } else if (v.metodo_pago === "tarjeta") totalTarjeta += t;
    else if (v.metodo_pago === "transferencia") totalTransferencia += t;
    else totalEfectivo += t; // efectivo o sin especificar
  }

  // Movimientos manuales ACTIVOS (excluye anulados — soft delete del modulo
  // 'Otros ingresos' que usa esta misma tabla via tipo='ingreso').
  const mQ = await sb
    .from("caja_movimientos")
    .select(
      "id, caja_id, tipo, concepto, monto, medio_pago, usuario_id, observacion, created_at"
    )
    .eq("empresa_id", empresaId)
    .eq("caja_id", caja.id)
    .is("anulado_at", null)
    .order("created_at", { ascending: true });
  if (mQ.error) throw new Error(mQ.error.message);
  const rows = (mQ.data ?? []) as unknown as Array<{
    id: string;
    caja_id: string;
    tipo: string;
    concepto: string;
    monto: number | string;
    medio_pago: string | null;
    usuario_id: string | null;
    observacion: string | null;
    created_at: string;
  }>;

  let ingresosEf = 0,
    egresosEf = 0,
    retirosEf = 0,
    ajustesEf = 0;
  const movimientos: CajaMovimiento[] = rows.map((m) => {
    const medio = (m.medio_pago ?? "efectivo") as MedioPagoCaja;
    const tipo = m.tipo as TipoMovimientoCaja;
    const monto = num(m.monto);
    if (medio === "efectivo") {
      if (tipo === "ingreso") ingresosEf += monto;
      else if (tipo === "egreso") egresosEf += monto;
      else if (tipo === "retiro") retirosEf += monto;
      else if (tipo === "ajuste") ajustesEf += monto;
    }
    return {
      id: m.id,
      caja_id: m.caja_id,
      tipo,
      concepto: m.concepto,
      monto,
      medio_pago: medio,
      usuario_id: m.usuario_id,
      observacion: m.observacion,
      created_at: m.created_at,
    };
  });

  const efectivoEsperado =
    caja.monto_apertura +
    totalEfectivo +
    ingresosEf -
    egresosEf -
    retirosEf +
    ajustesEf;

  return {
    caja,
    cantidad_ventas: count,
    total_vendido: totalVendido,
    total_efectivo: totalEfectivo,
    total_tarjeta: totalTarjeta,
    total_transferencia: totalTransferencia,
    ingresos_efectivo: ingresosEf,
    egresos_efectivo: egresosEf,
    retiros_efectivo: retirosEf,
    ajustes_efectivo: ajustesEf,
    efectivo_esperado: efectivoEsperado,
    movimientos,
  };
}

// ============================================================
// Otros ingresos (modulo dedicado)
// ============================================================
//
// Convencion: 'Otros ingresos' es una vista filtrada de caja_movimientos
// donde tipo='ingreso'. Reusa la misma tabla, asi suman a caja por
// computeResumen sin codigo extra. Lo nuevo aca es:
//  - Listado con filtros + caja info embebida.
//  - Anulacion soft (anulado_at + auditoria).

export interface OtroIngreso {
  id: string;
  caja_id: string;
  concepto: string;
  monto: number;
  medio_pago: MedioPagoCaja;
  observacion: string | null;
  usuario_id: string | null;
  usuario_email: string | null;
  created_at: string;
  anulado_at: string | null;
  anulado_por_id: string | null;
  anulado_motivo: string | null;
  // Info de la caja asociada (snapshot embebido).
  caja_estado: EstadoCaja | null;
  caja_fecha_apertura: string | null;
}

/**
 * Lista Otros Ingresos (tipo='ingreso' en caja_movimientos) con filtros.
 * Incluye anulados para mostrarlos tachados en el listado.
 */
export async function listOtrosIngresos(
  sb: AppSupabaseClient,
  empresaId: string,
  opts: {
    fechaDesde?: string;     // YYYY-MM-DD
    fechaHasta?: string;     // YYYY-MM-DD
    medioPago?: MedioPagoCaja;
    cajaId?: string;
    estado?: "activos" | "anulados" | "todos";
    q?: string;              // busca en concepto + observacion
    limit?: number;
  } = {}
): Promise<OtroIngreso[]> {
  const limit = Math.max(1, Math.min(500, opts.limit ?? 200));
  let q = sb
    .from("caja_movimientos")
    .select(
      "id, caja_id, tipo, concepto, monto, medio_pago, observacion, usuario_id, usuario_email, created_at, anulado_at, anulado_por_id, anulado_motivo"
    )
    .eq("empresa_id", empresaId)
    .eq("tipo", "ingreso")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (opts.medioPago) q = q.eq("medio_pago", opts.medioPago);
  if (opts.cajaId) q = q.eq("caja_id", opts.cajaId);
  if (opts.estado === "activos") q = q.is("anulado_at", null);
  else if (opts.estado === "anulados") q = q.not("anulado_at", "is", null);
  if (opts.fechaDesde) q = q.gte("created_at", `${opts.fechaDesde}T00:00:00`);
  if (opts.fechaHasta) q = q.lte("created_at", `${opts.fechaHasta}T23:59:59.999`);
  if (opts.q && opts.q.trim()) {
    // Búsqueda por tokens (cada palabra en cualquier orden) en concepto + observación.
    q = applyTokenSearch(q, opts.q, ["concepto", "observacion"]);
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Array<{
    id: string;
    caja_id: string;
    concepto: string;
    monto: number | string;
    medio_pago: string | null;
    observacion: string | null;
    usuario_id: string | null;
    usuario_email: string | null;
    created_at: string;
    anulado_at: string | null;
    anulado_por_id: string | null;
    anulado_motivo: string | null;
  }>;

  // Enrich con info de cajas (estado + fecha_apertura) para mostrar en UI.
  const cajaIds = [...new Set(rows.map((r) => r.caja_id))];
  const cajasById = new Map<string, { estado: EstadoCaja; fecha_apertura: string }>();
  if (cajaIds.length > 0) {
    const cQ = await sb
      .from("cajas")
      .select("id, estado, fecha_apertura")
      .eq("empresa_id", empresaId)
      .in("id", cajaIds);
    if (!cQ.error) {
      for (const c of (cQ.data ?? []) as Array<{ id: string; estado: string; fecha_apertura: string }>) {
        cajasById.set(c.id, {
          estado: estadoCaja(c.estado),
          fecha_apertura: c.fecha_apertura,
        });
      }
    }
  }

  function num(v: unknown): number {
    const n = typeof v === "number" ? v : Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  }

  return rows.map((r) => {
    const c = cajasById.get(r.caja_id);
    return {
      id: r.id,
      caja_id: r.caja_id,
      concepto: r.concepto,
      monto: num(r.monto),
      medio_pago: (r.medio_pago ?? "efectivo") as MedioPagoCaja,
      observacion: r.observacion,
      usuario_id: r.usuario_id,
      usuario_email: r.usuario_email,
      created_at: r.created_at,
      anulado_at: r.anulado_at,
      anulado_por_id: r.anulado_por_id,
      anulado_motivo: r.anulado_motivo,
      caja_estado: c?.estado ?? null,
      caja_fecha_apertura: c?.fecha_apertura ?? null,
    };
  });
}

/**
 * Anula un movimiento. Idempotente: si ya esta anulado devuelve OK sin
 * sobreescribir. Por seguridad solo se permite anular movimientos
 * tipo='ingreso' (Otros ingresos). Egresos/retiros/ajustes manejan su
 * vida desde el panel de Caja.
 */
export async function anularMovimiento(
  sb: AppSupabaseClient,
  params: {
    empresaId: string;
    movimientoId: string;
    usuarioId: string | null;
    motivo: string | null;
  }
): Promise<void> {
  const q = await sb
    .from("caja_movimientos")
    .select("id, tipo, anulado_at")
    .eq("empresa_id", params.empresaId)
    .eq("id", params.movimientoId)
    .maybeSingle();
  if (q.error) throw new Error(q.error.message);
  if (!q.data) throw new Error("Movimiento no encontrado.");
  const row = q.data as { tipo: string; anulado_at: string | null };
  if (row.tipo !== "ingreso") {
    throw new Error("Solo se pueden anular Otros ingresos desde este modulo.");
  }
  if (row.anulado_at) return; // idempotente

  const upd = await sb
    .from("caja_movimientos")
    .update({
      anulado_at: new Date().toISOString(),
      anulado_por_id: params.usuarioId,
      anulado_motivo: (params.motivo ?? "").trim().slice(0, 500) || null,
    })
    .eq("empresa_id", params.empresaId)
    .eq("id", params.movimientoId)
    .is("anulado_at", null);
  if (upd.error) throw new Error(upd.error.message);
}
