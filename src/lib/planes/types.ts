export type Periodicidad  = "mensual" | "anual" | "unico";
export type MonedaPlan    = "GS" | "USD";
export type EstadoPlan    = "activo" | "inactivo";

/** Item de plantilla operativa para planes de marketing */
export interface PlanMarketingItem {
  tipo_contenido: "post" | "reel" | "historia" | "anuncio" | "otro";
  periodicidad:   "semanal" | "mensual";
  cantidad:       number;
  dias_semana?:  number[];      // 0=dom...6=sáb, obligatorio si periodicidad=semanal
  semana_del_mes?: number;      // 1-4, obligatorio si periodicidad=mensual
}

export interface PlanMarketingPlantilla {
  items: PlanMarketingItem[];
}

export interface Plan {
  id:               string;
  codigo_plan:      string;          // PLAN-0001

  nombre:           string;
  descripcion?:     string;

  precio:           number;
  moneda:           MonedaPlan;

  periodicidad:     Periodicidad;

  limite_usuarios:  number | null;   // null = ilimitado
  limite_clientes:  number | null;
  limite_facturas:  number | null;

  estado:           EstadoPlan;

  /** Si es plan de marketing (genera tareas operativas) */
  es_plan_marketing?: boolean;
  /** Plantilla operativa cuando es_plan_marketing = true */
  plantilla_operativa?: PlanMarketingPlantilla | null;

  created_at:       string;          // ISO string
  updated_at:       string;          // ISO string
}
