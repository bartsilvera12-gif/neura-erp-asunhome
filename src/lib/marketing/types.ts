export type TipoContenido = "post" | "reel" | "historia" | "anuncio" | "otro";
export type EstadoMarketingTask = "pendiente" | "en_proceso" | "en_revision" | "aprobado" | "publicado";
export type PrioridadTask = "baja" | "media" | "alta" | "urgente";

export const TIPOS_CONTENIDO: TipoContenido[] = ["post", "reel", "historia", "anuncio", "otro"];
export const ESTADOS_TASK: EstadoMarketingTask[] = ["pendiente", "en_proceso", "en_revision", "aprobado", "publicado"];
export const PRIORIDADES: PrioridadTask[] = ["baja", "media", "alta", "urgente"];

export interface MarketingTask {
  id:                  string;
  empresa_id:          string;
  cliente_id:          string;
  titulo:              string;
  descripcion?:        string | null;
  tipo_contenido:      TipoContenido;
  estado:              EstadoMarketingTask;
  fecha_entrega:       string;  // YYYY-MM-DD
  responsable_user_id?: string | null;
  prioridad?:          PrioridadTask | null;
  /** Origen: suscripción que generó la tarea (si automática) */
  suscripcion_id?:     string | null;
  /** Origen: plan de marketing (si automática) */
  plan_id?:            string | null;
  /** true = generada por plan, false = creada manualmente */
  generada_automaticamente?: boolean;
  created_at:          string;
  updated_at:          string;
}

export interface NuevaMarketingTask {
  cliente_id:     string;
  titulo:         string;
  descripcion?:   string | null;
  tipo_contenido: TipoContenido;
  fecha_entrega:  string;
  responsable_user_id?: string | null;
  prioridad?:     PrioridadTask | null;
}
