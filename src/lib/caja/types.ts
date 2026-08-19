/**
 * Tipos del modulo Caja (turno de venta).
 *
 * Una "caja" es un turno: se abre con un monto inicial, mientras esta
 * abierta se le asocian ventas (ventas.caja_id) y movimientos manuales,
 * y se cierra contando el efectivo (arqueo).
 *
 * Soporta MULTIPLES cajas activas por empresa (Caja 1, Caja 2, …) via
 * `numero_caja`; el indice unique parcial en DB solo evita dos turnos
 * activos sobre el mismo numero.
 *
 * El conteo de apertura/cierre se puede cargar como monto directo o, si el
 * cajero usa el arqueo por denominaciones (monedas y billetes), el sistema
 * calcula monto_apertura/monto_cierre_contado desde ese detalle y lo persiste
 * en arqueo_apertura_json/arqueo_cierre_json para auditoría (ver ArqueoItem).
 */

import type { ArqueoItem } from "./denominaciones";

export type EstadoCaja = "abierta" | "en_cierre" | "cerrada";
export type TipoMovimientoCaja = "ingreso" | "egreso" | "retiro" | "ajuste";
export type MedioPagoCaja = "efectivo" | "tarjeta" | "transferencia" | "otro";

export type { ArqueoItem, TipoDenominacion, Denominacion } from "./denominaciones";

export interface Caja {
  id: string;
  numero_caja: number;
  estado: EstadoCaja;
  abierta_por: string | null;
  cerrada_por: string | null;
  fecha_apertura: string;
  fecha_cierre: string | null;
  monto_apertura: number;
  monto_cierre_contado: number | null;
  monto_esperado_efectivo: number | null;
  diferencia: number | null;
  observacion_apertura: string | null;
  observacion_cierre: string | null;
  /** Detalle del conteo físico al abrir (null si se cargó el monto directo). */
  arqueo_apertura_json: ArqueoItem[] | null;
  /** Detalle del conteo físico al cerrar (null si se cargó el monto directo). */
  arqueo_cierre_json: ArqueoItem[] | null;
}

export interface CajaMovimiento {
  id: string;
  caja_id: string;
  tipo: TipoMovimientoCaja;
  concepto: string;
  monto: number;
  medio_pago: MedioPagoCaja;
  usuario_id: string | null;
  observacion: string | null;
  created_at: string;
}

/**
 * Totales calculados de una caja (server-side, verdad del arqueo).
 *   efectivo_esperado = monto_apertura
 *                     + ventas efectivo
 *                     + ingresos efectivo
 *                     - egresos efectivo
 *                     - retiros efectivo
 *                     + ajustes efectivo (signado).
 * Tarjeta y transferencia suman al total_vendido pero NO al efectivo esperado.
 */
export interface CajaResumen {
  caja: Caja;
  cantidad_ventas: number;
  total_vendido: number;
  total_efectivo: number;
  total_tarjeta: number;
  total_transferencia: number;
  ingresos_efectivo: number;
  egresos_efectivo: number;
  retiros_efectivo: number;
  ajustes_efectivo: number;
  efectivo_esperado: number;
  movimientos: CajaMovimiento[];
}

/**
 * Una fila del reporte de cierres de caja: un turno con sus totales
 * agregados (ventas + movimientos) y el arqueo persistido al cierre.
 */
export interface CajaReporteRow {
  id: string;
  numero_caja: number;
  estado: EstadoCaja;
  fecha_apertura: string;
  fecha_cierre: string | null;
  abierta_por_nombre: string | null;
  cerrada_por_nombre: string | null;
  monto_apertura: number;
  cantidad_ventas: number;
  total_vendido: number;
  total_efectivo: number;
  total_tarjeta: number;
  total_transferencia: number;
  ingresos_efectivo: number;
  egresos_efectivo: number;
  retiros_efectivo: number;
  ajustes_efectivo: number;
  /** Efectivo esperado calculado en vivo (útil para cajas abiertas). */
  efectivo_esperado: number;
  /** Arqueo persistido al cerrar (null mientras la caja está abierta). */
  monto_esperado_efectivo: number | null;
  monto_cierre_contado: number | null;
  diferencia: number | null;
  observacion_cierre: string | null;
  /** Detalle del arqueo (auditoría). Null si el turno usó monto directo o es previo a esta función. */
  arqueo_apertura_json: ArqueoItem[] | null;
  arqueo_cierre_json: ArqueoItem[] | null;
}

/** Una venta individual realizada durante un turno de caja. */
export interface CajaDetalleVenta {
  id: string;
  numero_control: string | null;
  fecha: string;
  metodo_pago: MedioPagoCaja;
  tipo_venta: string | null;
  total: number;
  estado: string | null;
  usuario_nombre: string | null;
  /** Si fue pago mixto, desglose real por metodo (desde ventas_pagos_detalle). */
  desglose_pago?: { efectivo: number; tarjeta: number; transferencia: number } | null;
}

/** Un movimiento manual del turno, con el autor resuelto (nombre/email). */
export interface CajaDetalleMovimiento extends CajaMovimiento {
  usuario_email: string | null;
  usuario_nombre: string | null;
}

/**
 * Detalle completo de un turno de caja: la fila agregada del reporte
 * (cabecera + arqueo) más las ventas y los movimientos manuales realizados
 * durante el turno, en orden cronológico.
 */
export interface CajaDetalle {
  caja: CajaReporteRow;
  ventas: CajaDetalleVenta[];
  movimientos: CajaDetalleMovimiento[];
}

/** Reporte de cierres de caja por rango de fechas. */
export interface CajasReporte {
  desde: string;
  hasta: string;
  totales: {
    cantidad_cajas: number;
    cajas_abiertas: number;
    cajas_cerradas: number;
    total_vendido: number;
    total_efectivo: number;
    total_tarjeta: number;
    total_transferencia: number;
    /** Suma neta de diferencias (sobrante − faltante). */
    total_diferencia: number;
    /** Faltantes acumulados (valor absoluto de diferencias negativas). */
    faltantes: number;
    /** Sobrantes acumulados (diferencias positivas). */
    sobrantes: number;
    cajas_con_diferencia: number;
  };
  cajas: CajaReporteRow[];
}
