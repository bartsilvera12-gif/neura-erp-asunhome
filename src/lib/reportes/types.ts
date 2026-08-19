// Tipos de los reportes operativos (server-side, schema ferreteriarepublica).
// Fase 1: Estado de cuenta + Proveedores. Fase 2: Compras.
// (Ventas/Conciliación: pendientes.)

export interface MovimientoEstadoCuenta {
  fecha: string;
  tipo: string; // Venta | Compra | Gasto
  referencia: string;
  descripcion: string;
  entrada: number;
  salida: number;
}

export interface EstadoCuentaReporte {
  mes: string;
  ingresosVentas: number;
  compras: number;
  gastos: number;
  resultado: number; // ventas - compras - gastos
  /** Ventas a crédito del período (sin aplicación de pagos parciales). */
  porCobrar: number;
  /** Compras a crédito del período (sin aplicación de pagos parciales). */
  porPagar: number;
  movimientos: MovimientoEstadoCuenta[];
}

export interface ProveedorReporteRow {
  id: string;
  nombre: string;
  ruc: string | null;
  telefono: string | null;
  cantidad: number;
  total: number;
  ultima_compra: string | null;
}

export interface ProveedoresReporte {
  mes: string;
  totalProveedores: number;
  conCompras: number;
  totalComprado: number;
  compraPromedio: number;
  ultimaCompra: { numero_control: string; proveedor_nombre: string; total: number; fecha: string } | null;
  proveedores: ProveedorReporteRow[];
}

// ── Compras (modelo plano: filas de `compras` agrupadas por numero_control) ────

/** Una compra (agrupada por numero_control). subtotal/iva/total = suma de líneas. */
export interface CompraReporteRow {
  numero_control: string;
  fecha: string;
  proveedor_nombre: string;
  items_count: number;   // cantidad de líneas del grupo
  subtotal: number;
  monto_iva: number;
  total: number;
  tipo_pago: string;
  nro_timbrado: string | null;
  tiene_comprobante: boolean; // true si CUALQUIER línea del grupo tiene comprobante
}

/** Una línea de compra (una fila de `compras`). */
export interface ItemCompradoRow {
  numero_control: string;
  fecha: string;
  proveedor_nombre: string;
  producto_nombre: string;
  cantidad: number;
  costo_unitario: number;
  total_linea: number;
}

export interface CompraProveedorTotal {
  proveedor_nombre: string;
  compras: number; // numero_control distintos
  total: number;
}

export interface CompraProductoTotal {
  producto_nombre: string;
  cantidad: number;
  gasto: number;
}

export interface ComprasReporte {
  mes: string;
  totalComprado: number;
  cantidad: number;       // COUNT(DISTINCT numero_control) — compras distintas
  cantidadItems: number;  // count(*) — líneas compradas
  compraMasAlta: { numero_control: string; proveedor_nombre: string; total: number } | null;
  proveedorMayor: { proveedor_nombre: string; total: number } | null;
  productoMasComprado: { producto_nombre: string; cantidad: number } | null;
  productoMayorGasto: { producto_nombre: string; gasto: number } | null;
  porProveedor: CompraProveedorTotal[];
  porProducto: CompraProductoTotal[];
  compras: CompraReporteRow[];
  items: ItemCompradoRow[];
}

// ── Ventas (header `ventas` + líneas `ventas_items`, con tipo_precio) ──────────

export type TipoPrecioReporte = "minorista" | "mayorista" | "distribuidor" | "costo";

/** Totales por nivel de precio: monto e ítems (líneas). */
export interface VentaTipoPrecioTotal {
  items: number;
  total: number;
}

export interface VentaProductoTotal {
  producto_nombre: string;
  cantidad: number;
  total: number;
}

/** Una venta (cabecera). */
export interface VentaReporteRow {
  id: string;
  numero_control: string;
  fecha: string;
  cliente: string | null;
  metodo_pago: string | null;
  items_count: number;
  total: number;
}

/** Una línea de venta. tipo_precio nunca null en la salida (null → 'minorista'). */
export interface ItemVendidoRow {
  numero_control: string;
  fecha: string;
  producto_nombre: string;
  cantidad: number;
  precio_venta: number;
  subtotal: number;
  monto_iva: number;
  total_linea: number;
  tipo_precio: TipoPrecioReporte;
}

export interface VentasReporte {
  mes: string;
  totalVendido: number;
  cantidadVentas: number;
  cantidadItems: number;     // líneas vendidas
  ticketPromedio: number;
  unidadesVendidas: number;  // SUM(cantidad)
  /** Desglose por nivel de precio (datos null se cuentan como minorista). */
  porTipoPrecio: Record<TipoPrecioReporte, VentaTipoPrecioTotal>;
  porProducto: VentaProductoTotal[];
  ventas: VentaReporteRow[];
  items: ItemVendidoRow[];
}

// ── Conciliación bancaria (ventas_pagos_detalle, venta-céntrico) ──────────────

export interface ConciliacionAgrupado {
  clave: string;   // método o entidad
  cantidad: number;
  total: number;
}

/**
 * Un movimiento bancario a conciliar: cobro de venta contado (no efectivo) o
 * cobro de cuenta por cobrar (no efectivo). El efectivo NO entra en conciliación.
 */
export interface ConciliacionMovRow {
  id: string;
  tipo: "venta" | "cobro";
  fecha: string;
  numero: string | null;       // N° de venta asociado
  cliente: string | null;
  metodo_pago: string | null;
  entidad: string | null;
  entidad_codigo: string | null;
  referencia: string | null;   // N° de comprobante
  titular: string | null;
  monto: number;
  estado: "pendiente" | "aprobado" | "rechazado";
}

export interface ConciliacionReporte {
  mes: string;
  totalCobrado: number;          // SUM(monto) de movimientos bancarios (no efectivo)
  cantidadOperaciones: number;   // cantidad de movimientos
  porMetodo: ConciliacionAgrupado[];
  porEntidad: ConciliacionAgrupado[];
  movimientos: ConciliacionMovRow[];
}

// ── Panel de Compras (rango desde/hasta): compras + ordenados no comprados ──

/** Una compra registrada (agrupada por numero_control) dentro del período. */
export interface CompraPanelFila {
  numero_control: string;
  fecha: string;
  numero_factura: string | null;
  proveedor_nombre: string;
  items_count: number;
  total: number;
  estado: string;
  orden_compra_numero: string | null;
}

/**
 * Una línea de orden de compra con saldo pendiente de recibir/comprar.
 * (El modelo de OC es plano: una fila por producto, con cantidad_recibida
 * acumulada; por eso una recepción parcial nunca duplica la línea.)
 */
export interface OrdenPendienteFila {
  orden_item_id: string;
  numero_oc: string;
  fecha: string;
  proveedor_nombre: string;
  producto_id: string;
  producto_nombre: string;
  sku: string | null;
  cantidad_ordenada: number;
  cantidad_recibida: number;
  cantidad_pendiente: number;
  costo_unitario: number;
  subtotal_pendiente: number;
  estado: string; // 'pendiente' | 'recibida_parcial'
}

export interface ComprasPanel {
  desde: string;
  hasta: string;
  compras: CompraPanelFila[];
  pendientes: OrdenPendienteFila[];
  totales: {
    total_compras: number;      // cantidad de compras (por numero_control)
    monto_comprado: number;     // suma de totales de compras del período
    ordenes_pendientes: number; // cantidad de OC distintas con pendiente
    monto_pendiente: number;    // suma de subtotales pendientes estimados
  };
}

// ── Créditos por cliente (ventas a crédito / cuentas por cobrar) ────────────

/** Resumen de la deuda a crédito de un cliente (agregado de sus cuentas). */
export interface CreditoClienteFila {
  cliente_id: string;
  cliente_nombre: string;
  cliente_ruc: string | null;
  ventas_credito: number;    // cantidad de ventas a crédito
  total: number;             // suma de los totales
  cobrado: number;           // total - saldo
  saldo: number;             // saldo pendiente
  vencido: number;           // saldo cuyas cuotas ya vencieron
  proximo_vencimiento: string | null;
  ultima_venta: string | null;
  // Antigüedad del saldo (aging), en días de mora.
  por_vencer: number;        // aún no vencido (o sin fecha)
  vencido_1_30: number;
  vencido_31_60: number;
  vencido_61_90: number;
  vencido_90_mas: number;
}

/** Bucket de antigüedad para filtrar. */
export type AgingBucket = "todos" | "por_vencer" | "d_1_30" | "d_31_60" | "d_61_90" | "d_90_mas";

export interface CreditosReporte {
  totales: {
    clientes_con_saldo: number;
    ventas_credito: number;
    total_credito: number;
    total_cobrado: number;
    saldo_pendiente: number;
    monto_vencido: number;
    por_vencer: number;
    vencido_1_30: number;
    vencido_31_60: number;
    vencido_61_90: number;
    vencido_90_mas: number;
  };
  clientes: CreditoClienteFila[];
}

/** Una venta a crédito (cuenta por cobrar) del extracto de un cliente. */
export interface ExtractoCuentaFila {
  id: string;
  numero_venta: string | null;
  fecha_emision: string;
  fecha_vencimiento: string | null;
  total: number;
  saldo: number;
  cobrado: number;
  estado: string;
  dias_vencido: number; // >0 si venció y tiene saldo
}

/** Un cobro registrado del cliente (pago contra una cuenta). */
export interface ExtractoCobroFila {
  id: string;
  fecha_pago: string;
  numero_venta: string | null;
  monto: number;
  metodo_pago: string | null;
  referencia: string | null;
}

export interface ExtractoCliente {
  cliente: {
    id: string;
    nombre: string;
    ruc: string | null;
    telefono: string | null;
    direccion: string | null;
  };
  cuentas: ExtractoCuentaFila[];
  cobros: ExtractoCobroFila[];
  totales: {
    total: number;
    cobrado: number;
    saldo: number;
    vencido: number;
  };
}
