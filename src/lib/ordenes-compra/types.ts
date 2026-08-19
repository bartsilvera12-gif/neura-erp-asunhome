import type { TipoIva, TipoPago, Moneda } from "@/lib/compras/types";

export type EstadoOrdenCompra = "pendiente" | "recibida_parcial" | "recibida_total" | "cancelada";

/**
 * Orden de Compra (OC) — modelo PLANO igual que `compras`: una fila por
 * producto, todas comparten el mismo `numero_oc`. La OC NO impacta stock ni
 * pide factura; eso ocurre recién al "recibir" (registrar la compra real).
 */
export interface OrdenCompra {
  id: string;
  numero_oc: string;             // OC-000001, OC-000002, ...

  proveedor_id: string;
  proveedor_nombre: string;

  producto_id: string;
  producto_nombre: string;

  cantidad: number;
  /** Acumulado recibido de esta línea a través de una o más compras. */
  cantidad_recibida: number;
  /** Derivado: cantidad - cantidad_recibida (nunca negativo). */
  cantidad_pendiente: number;

  moneda: Moneda;
  tipo_cambio: number;
  costo_unitario_original: number; // en la moneda elegida
  costo_unitario: number;          // siempre PYG

  iva_tipo: TipoIva;
  subtotal: number;
  monto_iva: number;
  total: number;

  precio_venta: number;
  margen_venta: number;

  tipo_pago: TipoPago;
  plazo_dias?: number;

  estado: EstadoOrdenCompra;
  observacion?: string | null;

  // Trazabilidad
  compra_numero_control?: string | null; // COMP-XXXXXX cuando se recibió
  recibida_at?: string | null;
  cancelada_at?: string | null;
  cancelada_motivo?: string | null;

  fecha: string;                 // ISO
}
