export const MARKETING_OPS_PRIORIDADES = ["baja", "media", "alta", "urgente"] as const;
export const MARKETING_OPS_ESTADOS_PRODUCCION = [
  "por_hacer",
  "en_produccion",
  "revision_interna",
  "correccion_interna",
  "listo_para_enviar",
] as const;
export const MARKETING_OPS_ESTADOS_CLIENTE = [
  "no_enviado",
  "enviado",
  "aprobado",
  "con_correcciones",
  "sin_respuesta",
] as const;
export const MARKETING_OPS_ESTADOS_PUBLICACION = ["pendiente", "programado", "publicado", "cancelado"] as const;

export type MarketingOpsPrioridad = (typeof MARKETING_OPS_PRIORIDADES)[number];
export type MarketingOpsEstadoProduccion = (typeof MARKETING_OPS_ESTADOS_PRODUCCION)[number];
export type MarketingOpsEstadoCliente = (typeof MARKETING_OPS_ESTADOS_CLIENTE)[number];
export type MarketingOpsEstadoPublicacion = (typeof MARKETING_OPS_ESTADOS_PUBLICACION)[number];
export type MarketingOpsEstadoCampo = "estado_produccion" | "estado_cliente" | "estado_publicacion";

export type MarketingOpsPiezaRow = {
  id: string;
  empresa_id: string;
  calendario_id: string | null;
  cliente_id: string | null;
  titulo: string;
  tipo_pieza: string | null;
  canal: string | null;
  responsable_id: string | null;
  fecha_limite: string | null;
  fecha_publicacion: string | null;
  prioridad: MarketingOpsPrioridad;
  estado_produccion: MarketingOpsEstadoProduccion;
  estado_cliente: MarketingOpsEstadoCliente;
  estado_publicacion: MarketingOpsEstadoPublicacion;
  link_archivo: string | null;
  observaciones: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type MarketingOpsPieza = MarketingOpsPiezaRow & {
  cliente?: { id: string; nombre: string | null; empresa: string | null; nombre_contacto: string | null } | null;
  responsable?: { id: string; nombre: string | null; email: string | null } | null;
};

export type MarketingOpsComentario = {
  id: string;
  empresa_id: string;
  pieza_id: string;
  usuario_id: string | null;
  comentario: string;
  created_at: string;
  usuario_nombre?: string | null;
};

export type MarketingOpsHistorial = {
  id: string;
  empresa_id: string;
  pieza_id: string;
  campo: MarketingOpsEstadoCampo | string;
  estado_anterior: string | null;
  estado_nuevo: string | null;
  changed_by: string | null;
  changed_at: string;
  usuario_nombre?: string | null;
};

export type MarketingOpsDashboard = {
  pendientes: number;
  vencidas: number;
  en_produccion: number;
  en_revision: number;
  enviadas_cliente: number;
  aprobadas: number;
  programadas: number;
  publicadas: number;
};

export type MarketingOpsFilters = {
  cliente_id?: string | null;
  responsable_id?: string | null;
  prioridad?: string | null;
  estado_produccion?: string | null;
  estado_cliente?: string | null;
  estado_publicacion?: string | null;
  vencidas?: boolean;
  desde?: string | null;
  hasta?: string | null;
  q?: string | null;
};
