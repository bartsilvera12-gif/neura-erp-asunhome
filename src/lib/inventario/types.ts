export type MetodoValuacion = "CPP" | "FIFO" | "LIFO";
export type TipoMovimiento = "ENTRADA" | "SALIDA" | "AJUSTE";
export type OrigenMovimiento = "compra" | "venta" | "ajuste_manual" | "inventario_inicial";

export interface Producto {
  id: string;
  nombre: string;
  sku: string;
  costo_promedio: number;
  precio_venta: number;
  stock_actual: number;
  stock_minimo: number;
  unidad_medida: string;
  metodo_valuacion: MetodoValuacion;
  codigo_barras?: string | null;
  codigo_barras_interno?: boolean;
  imagen_path?: string | null;
  imagen_url?: string | null;
  categoria_principal_id?: string | null;
  ubicacion_principal_id?: string | null;
  proveedor_principal_id?: string | null;
  /** Clasificación gastronómica: producto que se vende al cliente final. */
  es_vendible?: boolean;
  /** Clasificación gastronómica: producto usado como insumo en recetas. */
  es_insumo?: boolean;
  /** Si false, no descuenta stock (ajustes/servicios). */
  controla_stock?: boolean;
  /** Si false, no entra en valuación (combos/promos). */
  valorizado?: boolean;
  /** Unidad usada al comprar (ej. "Bolsa 25kg"). */
  unidad_compra?: string | null;
  /** Unidad usada en recetas (ej. "g"). */
  unidad_receta?: string | null;
  /** Factor para 1 unidad_compra → unidades_receta (ej. 25000). */
  factor_compra_receta?: number;
  /** Tiempo estimado de preparación en minutos (para Kanban cocina). */
  tiempo_prep_minutos?: number;
  /** Descripción detallada (visible en Menú y edición). */
  descripcion?: string | null;
}

export interface MovimientoInventario {
  id: string;
  producto_id: string;
  producto_nombre: string;
  producto_sku: string;
  tipo: TipoMovimiento;
  cantidad: number;
  costo_unitario: number;
  origen: OrigenMovimiento;
  fecha: string;       // ISO string
  referencia?: string; // ej: "COMP-000001"
  created_by?: string | null;
  usuario_nombre?: string | null;
}
