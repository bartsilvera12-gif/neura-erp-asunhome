/**
 * Tipos para presentaciones de venta de un producto.
 *
 * Una presentacion define COMO se vende un producto:
 * - Unidad (cantidad_base = 1)
 * - Caja (cantidad_base = 1000 si la caja trae 1000 unidades)
 * - Paquete (cantidad_base = 12, etc.)
 *
 * El stock se mantiene siempre en `unidad_medida` (la unidad base del
 * producto). Cuando se vende N unidades de una presentacion, se descuenta
 * `N * cantidad_base` del stock del producto.
 */

export interface ProductoPresentacion {
  id: string;
  empresa_id: string;
  producto_id: string;
  nombre: string;
  cantidad_base: number;
  /** Override opcional. Si null, la UI computa precio_venta * cantidad_base. */
  precio_venta: number | null;
  es_default: boolean;
  activo: boolean;
  created_at: string;
  updated_at: string;
}

/** Input para crear o editar una presentacion. */
export interface ProductoPresentacionInput {
  nombre: string;
  cantidad_base: number;
  precio_venta: number | null;
  es_default?: boolean;
  activo?: boolean;
}

/**
 * Snapshot que se guarda en `ventas_items` al momento de la venta. Si la
 * presentacion despues cambia su cantidad_base, las ventas historicas siguen
 * mostrando el dato de cuando se vendieron.
 */
export interface VentaItemPresentacionSnapshot {
  presentacion_id: string | null;
  presentacion_nombre: string | null;
  presentacion_cantidad_base: number | null;
  cantidad_total_base: number | null;
}
