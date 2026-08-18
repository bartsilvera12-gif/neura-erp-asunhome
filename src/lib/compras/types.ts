export type TipoPago = "contado" | "credito";
export type TipoIva = "exenta" | "5" | "10";
export type Moneda = "PYG" | "USD";

export interface Compra {
  id: string;
  numero_control: string;        // COMP-000001, COMP-000002, ...

  proveedor_id: string;
  proveedor_nombre: string;

  producto_id: string;
  producto_nombre: string;

  cantidad: number;

  moneda: Moneda;
  tipo_cambio: number;           // 1 si PYG; cotización si USD
  costo_unitario_original: number; // en la moneda elegida
  costo_unitario: number;        // siempre en PYG (para impacto en inventario)

  iva_tipo: TipoIva;
  subtotal: number;              // PYG, antes de IVA
  monto_iva: number;             // PYG
  total: number;                 // PYG, total con IVA

  precio_venta: number;          // PYG, precio de venta sugerido
  margen_venta: number;          // % margen sobre venta

  tipo_pago: TipoPago;
  plazo_dias?: number;           // solo si tipo_pago === "credito"

  nro_timbrado: string;

  fecha: string;                 // ISO string, generado automáticamente
}
