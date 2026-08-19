export type MetodoValuacion = "CPP" | "FIFO" | "LIFO";
export type TipoMovimiento = "ENTRADA" | "SALIDA" | "AJUSTE";
export type OrigenMovimiento = "compra" | "venta" | "ajuste_manual" | "inventario_inicial" | "devolucion_venta";

export interface Producto {
  id: string;
  nombre: string;
  sku: string;
  costo_promedio: number;
  precio_venta: number;            // precio minorista
  /** Precio mayorista (opcional, informativo — no se aplica automáticamente en ventas). */
  precio_mayorista?: number | null;
  /** Cantidad mínima para precio mayorista (opcional, informativo). */
  cantidad_minima_mayorista?: number | null;
  /** Precio distribuidor (opcional). Precio comercial por canal — NO es el costo. */
  precio_distribuidor?: number | null;
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
  /** Si true, aparece en la sección "Productos destacados" del sitio público. */
  destacado?: boolean;
  /** Si true, aparece en el banner "Ofertas de la semana" del home público (máx 3). */
  oferta_semana_destacada?: boolean;
  /** Descuento promocional: 'percentage' | 'fixed' | null. */
  discount_type?: "percentage" | "fixed" | null;
  /** Valor del descuento (% si percentage, Gs. si fixed). */
  discount_value?: number | null;
  /** Inicio de la ventana de oferta (ISO). null = sin restriccion. */
  discount_starts_at?: string | null;
  /** Fin de la ventana de oferta (ISO). null = sin restriccion. */
  discount_ends_at?: string | null;
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
  /** Modo de receta (productos de Menú): 'preparado_al_vender' | 'produccion_previa'. */
  modo_receta?: string;
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
