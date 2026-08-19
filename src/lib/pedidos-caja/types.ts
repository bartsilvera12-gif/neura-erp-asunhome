/**
 * Tipos del modulo Consulta / pedidos a caja.
 *
 * Un pedido_caja es un carrito armado por un vendedor desde /consulta que
 * espera a que el cajero lo cobre en /ventas/nueva. Cuando se cobra, queda
 * 'facturado' y vinculado a la venta resultante.
 */

export type EstadoPedidoCaja =
  | "pendiente"  // Vendedor creo el pedido, esperando que caja lo tome.
  | "en_caja"    // Cajero abrio el pedido en /ventas/nueva (procesandolo).
  | "facturado"  // Cajero cobro y emitio venta. Inmutable.
  | "cancelado"; // Anulado antes de facturar. Inmutable.

export interface PedidoCajaItem {
  producto_id: string;
  producto_nombre: string;
  sku: string | null;
  cantidad: number;
  precio_venta: number;
  tipo_precio: "minorista" | "mayorista" | "distribuidor";
  /** IVA aplicado a la linea. Default '10%' si no viene (items legacy). */
  tipo_iva?: "EXENTA" | "5%" | "10%";
  // Presentacion opcional (Caja, Paquete...). Snapshot al momento del pedido.
  presentacion_id?: string | null;
  presentacion_nombre?: string | null;
  presentacion_cantidad_base?: number | null;
}

export interface PedidoCaja {
  id: string;
  /** Numero visible PED-XXXXXX. Generado al crear. */
  numero: string | null;
  titulo: string;
  cliente_id: string | null;
  cliente_nombre: string | null;
  cliente_telefono: string | null;
  observacion: string | null;
  items: PedidoCajaItem[];
  total_estimado: number;
  estado: EstadoPedidoCaja;
  /**
   * true = está en la cola de Caja (aparece en "Pedidos por cobrar").
   * false = liberado: devuelto al vendedor para editar; NO se cobra hasta
   * que lo vuelvan a "Enviar a Caja".
   */
  en_cola_caja: boolean;
  venta_id: string | null;
  venta_numero: string | null;
  armado_por_id: string | null;
  armado_por_email: string | null;
  /** Cajero que abrio el pedido (estado en_caja). */
  abierto_por_id: string | null;
  abierto_por_email: string | null;
  abierto_at: string | null;
  created_at: string;
  facturado_at: string | null;
  cancelado_at: string | null;
  cancelado_motivo: string | null;
}
