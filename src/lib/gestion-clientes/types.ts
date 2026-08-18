export type TipoGestion =
  | "Consulta"
  | "Reclamo"
  | "Seguimiento"
  | "Promesa de pago"
  | "Soporte técnico"
  | "Cambio plan";

export type ResultadoTipificacion = "Pendiente" | "Resuelto" | "Escalar";

export interface Tipificacion {
  id:           string;
  cliente_id:   string;
  fecha:        string;               // ISO string
  usuario:      string;
  tipo_gestion: TipoGestion;
  resultado:    ResultadoTipificacion;
  observacion:  string;
}

/** `Corregida NC`: saldo liquidado por nota de crédito aprobada por SET (no es cobro registrado en `pagos`). */
export type EstadoFactura = "Pagado" | "Pendiente" | "Vencido" | "Anulado" | "Corregida NC";

export interface Factura {
  id:                string;
  cliente_id:        string;
  numero_factura:    string;
  fecha:             string;          // YYYY-MM-DD
  fecha_vencimiento: string;          // YYYY-MM-DD
  monto:             number;
  saldo:             number;
  estado:            EstadoFactura;
  tipo:              "contado" | "credito" | "suscripcion";
  moneda:            "GS" | "USD";
  /** Última fecha de pago registrada en `pagos` (GET /api/facturas enriquecido). */
  fecha_pago_registro?: string | null;
}
