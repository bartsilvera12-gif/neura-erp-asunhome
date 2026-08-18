export type EstadoSuscripcion = "activa" | "pausada" | "cancelada";

export interface Suscripcion {
  id:                     string;
  cliente_id:             string;
  plan_id:                string | null;
  plan_nombre?:           string;
  precio:                 number;
  moneda:                 "GS" | "USD";
  fecha_inicio:           string;
  duracion_meses:         number;
  dia_facturacion:        number;
  dia_vencimiento:        number;
  estado:                 EstadoSuscripcion;
  generar_factura_este_mes: boolean;
  created_at:             string;
}

export interface FacturaItem {
  id:              string;
  factura_id:      string;
  descripcion:     string;
  cantidad:        number;
  precio_unitario: number;
  subtotal:        number;
  iva:             number;
  total:           number;
}

export type MetodoPago = "efectivo" | "transferencia" | "cheque" | "tarjeta" | "otro";

export interface Pago {
  id:          string;
  factura_id:  string;
  monto:       number;
  fecha_pago:  string;
  metodo_pago: MetodoPago;
  referencia?: string;
  created_at:  string;
}
