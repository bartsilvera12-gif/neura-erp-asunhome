export type EstadoProveedor = "activo" | "inactivo";

export type CondicionPagoProveedor = "contado" | "credito" | "mixto";

/** Categoría maestra (tenant). */
export interface ProveedorCategoria {
  id: string;
  empresa_id?: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  created_at?: string;
  updated_at?: string;
}

/** Proveedor persistido en DB (cabecera + categorías resueltas en GET). */
export interface Proveedor {
  id: string;
  empresa_id?: string;
  nombre: string;
  nombre_comercial: string | null;
  razon_social: string | null;
  ruc: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  contacto: string | null;
  estado: EstadoProveedor;
  condicion_pago: CondicionPagoProveedor | null;
  plazo_pago_dias: number | null;
  /** Días de gracia antes del primer vencimiento (cuentas por pagar). */
  dias_gracia: number | null;
  /** Plazos de cuotas en días desde el fin de la gracia (ej. [30,60,90,120]). */
  plazos_cuotas: number[] | null;
  moneda_preferida: "GS" | "USD" | null;
  observaciones: string | null;
  created_at: string;
  updated_at: string;
  /** Solo en lecturas que join-ean categorías */
  categorias?: Pick<ProveedorCategoria, "id" | "nombre" | "activo">[];
}

/** Alta rápida desde compras u otros flujos (mínimos obligatorios en API). */
export type NuevoProveedorInput = {
  nombre: string;
  nombre_comercial?: string | null;
  razon_social?: string | null;
  ruc?: string | null;
  telefono?: string | null;
  email?: string | null;
  direccion?: string | null;
  contacto?: string | null;
  estado?: EstadoProveedor;
  condicion_pago?: CondicionPagoProveedor | null;
  plazo_pago_dias?: number | null;
  dias_gracia?: number | null;
  plazos_cuotas?: number[] | null;
  moneda_preferida?: "GS" | "USD" | null;
  observaciones?: string | null;
  categoria_ids?: string[];
};
