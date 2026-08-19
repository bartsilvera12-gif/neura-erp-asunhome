export type EstadoPresupuesto = "creado" | "enviado" | "aprobado" | "rechazado" | "convertido";

export type IvaTipoPresupuesto = "EXENTA" | "5%" | "10%";

export const ESTADOS_PRESUPUESTO: EstadoPresupuesto[] = [
  "creado",
  "enviado",
  "aprobado",
  "rechazado",
  "convertido",
];

export const ESTADO_LABEL: Record<EstadoPresupuesto, string> = {
  creado: "Creado",
  enviado: "Enviado",
  aprobado: "Aprobado",
  rechazado: "Rechazado",
  convertido: "Convertido",
};

export interface PresupuestoItem {
  id?: string;
  producto_id: string | null;
  producto_nombre: string;
  sku: string | null;
  cantidad: number;
  unidad_medida: string | null;
  precio_unitario: number;
  iva_tipo: IvaTipoPresupuesto;
  subtotal: number;
  monto_iva: number;
  descuento: number;
  total: number;
}

export interface Presupuesto {
  id: string;
  empresa_id?: string;
  cliente_id: string | null;
  cliente_nombre: string;
  cliente_ruc: string | null;
  cliente_telefono: string | null;
  cliente_direccion: string | null;
  numero_control: string;
  estado: EstadoPresupuesto;
  moneda: string;
  subtotal: number;
  monto_iva: number;
  descuento_total: number;
  total: number;
  validez_dias: number | null;
  fecha: string;
  fecha_vencimiento: string | null;
  forma_pago: string | null;
  plazo_entrega: string | null;
  observaciones: string | null;
  convertido_pedido_id: string | null;
  convertido_venta_id: string | null;
  created_at?: string;
  updated_at?: string;
  items?: PresupuestoItem[];
}

/** IVA incluido en el precio (Paraguay): el monto de IVA se calcula desde el total. */
export function calcMontoIvaIncluido(tipo: IvaTipoPresupuesto, base: number): number {
  if (tipo === "EXENTA") return 0;
  if (tipo === "5%") return base - base / 1.05;
  return base - base / 1.1;
}
