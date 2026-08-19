/** Tipos del modulo de devoluciones de ventas. */

export type TipoDevolucion = "total" | "parcial";
export type ResolucionDevolucion = "reembolso" | "cambio";
export type EstadoDevolucion = "confirmada" | "anulada";
export type CondicionProducto = "buen_estado" | "danado";
export type MetodoReembolso = "efectivo" | "tarjeta" | "transferencia";

/** Linea de la venta con lo ya devuelto (para armar el paso 1 del wizard). */
export interface LineaDevolvible {
  venta_item_id: string;
  producto_id: string;
  producto_nombre: string;
  sku: string | null;
  tipo_iva: string;
  precio_unitario: number;
  cantidad_vendida: number;
  cantidad_devuelta: number;
  cantidad_disponible: number;
}

/** Venta + lineas devolvibles + contexto fiscal. */
export interface VentaDevolvible {
  venta_id: string;
  numero_control: string;
  fecha: string;
  estado: string;
  metodo_pago: string | null;
  total: number;
  cliente_id: string | null;
  cliente_nombre: string | null;
  /** La venta tiene factura autoimpresor emitida -> avisar sobre Nota de Credito. */
  tiene_factura_fiscal: boolean;
  lineas: LineaDevolvible[];
}

/** Item a devolver que llega del cliente. */
export interface DevolucionItemInput {
  venta_item_id: string;
  cantidad: number;
  condicion: CondicionProducto;
  /** Solo aplica si condicion = buen_estado. Un producto danado nunca reintegra. */
  reintegra_stock: boolean;
}

/** Producto entregado como cambio. */
export interface DevolucionCambioInput {
  producto_id: string;
  cantidad: number;
}

export interface CrearDevolucionInput {
  venta_id: string;
  motivo: string | null;
  resolucion: ResolucionDevolucion;
  items: DevolucionItemInput[];
  /** Solo si resolucion = cambio. */
  cambios: DevolucionCambioInput[];
  /** Metodo del reembolso o del cobro de la diferencia. */
  metodo: MetodoReembolso;
  /** Clave para idempotencia (doble clic / reintento). */
  idempotency_key: string;
}

export interface DevolucionItemRow {
  id: string;
  venta_item_id: string;
  producto_id: string;
  producto_nombre: string;
  sku: string | null;
  cantidad_vendida: number;
  cantidad_devuelta: number;
  precio_unitario: number;
  tipo_iva: string;
  monto_iva: number;
  total_devuelto: number;
  condicion: CondicionProducto;
  reintegra_stock: boolean;
}

export interface DevolucionCambioRow {
  id: string;
  producto_id: string;
  producto_nombre: string;
  sku: string | null;
  cantidad: number;
  precio_unitario: number;
  tipo_iva: string;
  monto_iva: number;
  total: number;
}

export interface Devolucion {
  id: string;
  numero_devolucion: string;
  venta_id: string;
  venta_numero_control: string | null;
  venta_fecha: string | null;
  cliente_id: string | null;
  cliente_nombre: string | null;
  tipo: TipoDevolucion;
  resolucion: ResolucionDevolucion;
  estado: EstadoDevolucion;
  motivo: string | null;
  total_devuelto: number;
  total_entregado: number;
  /** > 0: el cliente paga. < 0: se le devuelve dinero. 0: sin movimiento. */
  diferencia: number;
  metodo_reembolso: MetodoReembolso | null;
  caja_id: string | null;
  caja_movimiento_id: string | null;
  requiere_nota_credito: boolean;
  created_by: string | null;
  usuario_nombre: string | null;
  created_at: string;
  anulada_at: string | null;
  anulada_motivo: string | null;
  items?: DevolucionItemRow[];
  cambios?: DevolucionCambioRow[];
}

/** Motivos por los que la confirmacion se bloquea (mapeados a HTTP 4xx). */
export type BloqueoDevolucion =
  | "sin_caja_abierta"
  | "cantidad_excedida"
  | "venta_no_encontrada"
  | "venta_anulada"
  | "sin_items"
  | "stock_insuficiente_cambio"
  | "devolucion_no_encontrada"
  | "devolucion_ya_anulada";

export class DevolucionBloqueadaError extends Error {
  motivo: BloqueoDevolucion;
  constructor(motivo: BloqueoDevolucion, message: string) {
    super(message);
    this.name = "DevolucionBloqueadaError";
    this.motivo = motivo;
  }
}

/** IVA incluido en el precio (Paraguay): el monto de IVA se extrae del total. */
export function calcIvaIncluido(tipoIva: string, total: number): number {
  const t = String(tipoIva).toUpperCase();
  if (t === "10%") return total - total / 1.1;
  if (t === "5%") return total - total / 1.05;
  return 0;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
