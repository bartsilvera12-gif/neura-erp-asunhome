/** Etapas clásicas (para compatibilidad). Las etapas reales vienen de crm_etapas. */
export type EtapaFunnel =
  | "LEAD"
  | "CONTACTADO"
  | "NEGOCIACION"
  | "GANADO"
  | "PERDIDO";

export interface Nota {
  id:     string;
  texto:  string;
  fecha:  string; // ISO string
}

export interface Prospecto {
  id:                    string;
  numero_control:        string;       // CRM-000001, CRM-000002, …
  empresa:               string;
  contacto:              string;
  email?:                string;
  telefono?:             string;
  servicio:              string;       // producto / servicio de interés
  valor_estimado:        number;       // en GS
  etapa:                 string;       // codigo de crm_etapas (LEAD, GANADO, etc.)
  proxima_accion?:       string;       // descripción de la próxima acción
  fecha_proxima_accion?: string;       // YYYY-MM-DD
  creado_por?:           string;       // nombre del usuario que creó el prospecto
  origen_creacion?:
    | "manual"
    | "whatsapp"
    | "formulario_web"
    | "referido"
    | "campaña_meta"
    | "automatizacion"
    | "otro";
  origen_detalle?:      string | null;
  responsable?:          string;       // nombre del responsable de seguimiento
  /** Texto libre interno (no es el timeline de crm_notas). */
  observaciones?:       string | null;
  notas:                 Nota[];
  fecha_creacion:        string;       // ISO string, automático
  fecha_actualizacion:   string;       // ISO string, actualizado en cada cambio
  cliente_creado?:       boolean;      // true cuando se generó el cliente asociado
}
