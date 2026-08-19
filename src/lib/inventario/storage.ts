import { getCurrentUser } from "@/lib/auth";
import { getBrowserSupabaseForEmpresaData } from "@/lib/supabase/browser-data-client";
import type {
  Producto,
  MovimientoInventario,
  MetodoValuacion,
  TipoMovimiento,
} from "./types";

// ─── Tipos de fila Supabase ───────────────────────────────────────────────────

interface ProductoRow {
  id: string;
  empresa_id: string;
  nombre: string;
  sku: string;
  costo_promedio: number;
  precio_venta: number;
  precio_mayorista?: number | string | null;
  cantidad_minima_mayorista?: number | string | null;
  precio_distribuidor?: number | string | null;
  stock_actual: number;
  stock_minimo: number;
  unidad_medida: string;
  metodo_valuacion: string;
  activo: boolean;
  created_at: string;
  updated_at: string;
  codigo_barras?: string | null;
  codigo_barras_interno?: boolean | null;
  imagen_path?: string | null;
  imagen_url?: string | null;
  categoria_principal_id?: string | null;
  ubicacion_principal_id?: string | null;
  proveedor_principal_id?: string | null;
  es_vendible?: boolean | null;
  es_insumo?: boolean | null;
  controla_stock?: boolean | null;
  destacado?: boolean | null;
  oferta_semana_destacada?: boolean | null;
  discount_type?: string | null;
  discount_value?: number | string | null;
  discount_starts_at?: string | null;
  discount_ends_at?: string | null;
  valorizado?: boolean | null;
  unidad_compra?: string | null;
  unidad_receta?: string | null;
  factor_compra_receta?: string | number | null;
  tiempo_prep_minutos?: number | null;
  descripcion?: string | null;
  modo_receta?: string | null;
}

interface MovimientoRow {
  id: string;
  empresa_id: string;
  producto_id: string;
  producto_nombre: string;
  producto_sku: string;
  tipo: string;
  cantidad: number;
  costo_unitario: number;
  origen: string;
  referencia: string | null;
  fecha: string;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
  usuario_nombre?: string | null;
}

// ─── Mapeo fila → tipo ────────────────────────────────────────────────────────

function rowToProducto(row: ProductoRow): Producto {
  return {
    id: row.id,
    nombre: row.nombre,
    sku: row.sku,
    costo_promedio: Number(row.costo_promedio),
    precio_venta: Number(row.precio_venta),
    precio_mayorista: row.precio_mayorista != null ? Number(row.precio_mayorista) : null,
    cantidad_minima_mayorista: row.cantidad_minima_mayorista != null ? Number(row.cantidad_minima_mayorista) : null,
    precio_distribuidor: row.precio_distribuidor != null ? Number(row.precio_distribuidor) : null,
    stock_actual: Number(row.stock_actual),
    stock_minimo: Number(row.stock_minimo),
    unidad_medida: row.unidad_medida,
    metodo_valuacion: row.metodo_valuacion as MetodoValuacion,
    codigo_barras: row.codigo_barras ?? null,
    codigo_barras_interno: row.codigo_barras_interno ?? false,
    imagen_path: row.imagen_path ?? null,
    imagen_url: row.imagen_url ?? null,
    categoria_principal_id: row.categoria_principal_id ?? null,
    ubicacion_principal_id: row.ubicacion_principal_id ?? null,
    proveedor_principal_id: row.proveedor_principal_id ?? null,
    es_vendible: row.es_vendible ?? true,
    es_insumo: row.es_insumo ?? false,
    controla_stock: row.controla_stock ?? true,
    destacado: row.destacado ?? false,
    oferta_semana_destacada: row.oferta_semana_destacada ?? false,
    discount_type:
      row.discount_type === "percentage" || row.discount_type === "fixed"
        ? row.discount_type
        : null,
    discount_value: row.discount_value != null ? Number(row.discount_value) : 0,
    discount_starts_at: row.discount_starts_at ?? null,
    discount_ends_at: row.discount_ends_at ?? null,
    valorizado: row.valorizado ?? true,
    unidad_compra: row.unidad_compra ?? null,
    unidad_receta: row.unidad_receta ?? null,
    factor_compra_receta: row.factor_compra_receta != null ? Number(row.factor_compra_receta) : 1,
    tiempo_prep_minutos: row.tiempo_prep_minutos != null ? Number(row.tiempo_prep_minutos) : 0,
    descripcion: row.descripcion ?? null,
    modo_receta: row.modo_receta ?? "preparado_al_vender",
  };
}

function rowToMovimiento(row: MovimientoRow): MovimientoInventario {
  return {
    id: row.id,
    producto_id: row.producto_id,
    producto_nombre: row.producto_nombre,
    producto_sku: row.producto_sku,
    tipo: row.tipo as TipoMovimiento,
    cantidad: Number(row.cantidad),
    costo_unitario: Number(row.costo_unitario),
    origen: row.origen as MovimientoInventario["origen"],
    referencia: row.referencia ?? undefined,
    fecha: row.fecha,
    created_by: row.created_by ?? null,
    usuario_nombre: row.usuario_nombre ?? null,
  };
}

// ─── Productos ─────────────────────────────────────────────────────────────────

/** Lista productos via API server-side (PG directo, soporta tenants erp_* no expuestos). */
export async function getProductos(): Promise<Producto[]> {
  try {
    const r = await fetch("/api/productos", { credentials: "include", cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) {
      console.error("[inventario] getProductos:", (j as { error?: string })?.error ?? r.status);
      return [];
    }
    const list = ((j.data as { productos?: ProductoRow[] }).productos ?? []) as ProductoRow[];
    return list.map(rowToProducto);
  } catch (err) {
    console.error("[inventario] getProductos:", err instanceof Error ? err.message : err);
    return [];
  }
}

export interface ProductosPaginadosOpts {
  page?: number;
  pageSize?: number;
  q?: string;
  /** uuid de categoria | "__sin__" para los que no tienen categoria asignada | "" para todas */
  categoria?: string;
}
export interface ProductosPaginadosResult {
  productos: Producto[];
  total: number;
}

/**
 * Lista paginada de productos con filtros server-side (busqueda y categoria).
 * Usado por la pantalla principal de inventario.
 */
export async function getProductosPaginated(
  opts: ProductosPaginadosOpts = {}
): Promise<ProductosPaginadosResult> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.max(1, Math.min(500, opts.pageSize ?? 25));
  const offset = (page - 1) * pageSize;
  const params = new URLSearchParams();
  params.set("limit", String(pageSize));
  params.set("offset", String(offset));
  if (opts.q && opts.q.trim()) params.set("q", opts.q.trim());
  if (opts.categoria) params.set("categoria", opts.categoria);
  try {
    const r = await fetch(`/api/productos?${params.toString()}`, {
      credentials: "include",
      cache: "no-store",
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) {
      console.error("[inventario] getProductosPaginated:", (j as { error?: string })?.error ?? r.status);
      return { productos: [], total: 0 };
    }
    const data = j.data as { productos?: ProductoRow[]; total?: number };
    const list = (data.productos ?? []) as ProductoRow[];
    return { productos: list.map(rowToProducto), total: Number(data.total) || 0 };
  } catch (err) {
    console.error("[inventario] getProductosPaginated:", err instanceof Error ? err.message : err);
    return { productos: [], total: 0 };
  }
}

/** Obtiene un producto por ID via API server-side. */
export async function getProducto(id: string): Promise<Producto | null> {
  try {
    const r = await fetch(`/api/productos/${encodeURIComponent(id)}`, {
      credentials: "include",
      cache: "no-store",
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) {
      console.error("[inventario] getProducto:", (j as { error?: string })?.error ?? r.status);
      return null;
    }
    const row = (j.data as { producto?: ProductoRow }).producto;
    return row ? rowToProducto(row) : null;
  } catch (err) {
    console.error("[inventario] getProducto:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Comprueba si ya existe un producto con el mismo SKU o nombre (case-insensitive).
 * Devuelve el producto encontrado o null.
 */
export async function productoExiste(
  sku: string,
  nombre: string
): Promise<Producto | null> {
  const productos = await getProductos();
  const skuNorm = sku.toLowerCase().trim();
  const nombreNorm = nombre.toLowerCase().trim();
  return (
    productos.find(
      (p) =>
        p.sku.toLowerCase() === skuNorm ||
        p.nombre.toLowerCase() === nombreNorm
    ) ?? null
  );
}

export type NuevoProductoData = Omit<Producto, "id">;

/**
 * Crea producto via API server-side (POST /api/productos).
 *
 * Se mueve a server porque el cliente browser no tiene permisos para leer
 * `zentra_erp.usuarios` (RLS / GRANT) y el patrón canonico del repo es
 * resolver auth + tenant via getTenantSupabaseFromAuth en el backend.
 * El movimiento de inventario_inicial (cuando stock_actual > 0) tambien
 * se hace server-side dentro del mismo handler.
 */
export async function saveProducto(
  datos: NuevoProductoData
): Promise<Producto | null> {
  const body = {
    nombre: datos.nombre,
    sku: datos.sku,
    costo_promedio: datos.costo_promedio,
    precio_venta: datos.precio_venta,
    precio_mayorista: datos.precio_mayorista ?? null,
    cantidad_minima_mayorista: datos.cantidad_minima_mayorista ?? null,
    precio_distribuidor: datos.precio_distribuidor ?? null,
    stock_actual: datos.stock_actual ?? 0,
    stock_minimo: datos.stock_minimo ?? 0,
    unidad_medida: datos.unidad_medida || "Unidad",
    metodo_valuacion: datos.metodo_valuacion,
    codigo_barras:
      datos.codigo_barras !== undefined && datos.codigo_barras !== null && datos.codigo_barras !== ""
        ? datos.codigo_barras
        : null,
    codigo_barras_interno: datos.codigo_barras_interno === true,
    categoria_principal_id: datos.categoria_principal_id ?? null,
    ubicacion_principal_id: datos.ubicacion_principal_id ?? null,
    proveedor_principal_id: datos.proveedor_principal_id ?? null,
    es_vendible: typeof datos.es_vendible === "boolean" ? datos.es_vendible : true,
    es_insumo: typeof datos.es_insumo === "boolean" ? datos.es_insumo : false,
    controla_stock: typeof datos.controla_stock === "boolean" ? datos.controla_stock : true,
    destacado: typeof datos.destacado === "boolean" ? datos.destacado : false,
    discount_type:
      datos.discount_type === "percentage" || datos.discount_type === "fixed"
        ? datos.discount_type
        : null,
    discount_value:
      typeof datos.discount_value === "number" && datos.discount_value >= 0
        ? datos.discount_value
        : 0,
    discount_starts_at: datos.discount_starts_at ?? null,
    discount_ends_at: datos.discount_ends_at ?? null,
    valorizado: typeof datos.valorizado === "boolean" ? datos.valorizado : true,
    unidad_compra: datos.unidad_compra ?? null,
    unidad_receta: datos.unidad_receta ?? null,
    factor_compra_receta:
      typeof datos.factor_compra_receta === "number" && datos.factor_compra_receta > 0
        ? datos.factor_compra_receta
        : 1,
    tiempo_prep_minutos:
      typeof datos.tiempo_prep_minutos === "number" && datos.tiempo_prep_minutos >= 0
        ? datos.tiempo_prep_minutos
        : 0,
    descripcion: datos.descripcion ?? null,
  };

  const res = await fetch("/api/productos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
  });
  const json = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok || !json?.success) {
    const msg = (json as { error?: string })?.error ?? `Error ${res.status} al guardar producto.`;
    // 409 (conflicto) o validacion: lanzar para que la UI lo muestre.
    if (res.status === 409 || res.status === 400) throw new Error(msg);
    console.error("[inventario] saveProducto:", msg);
    throw new Error(msg);
  }

  const data = (json.data as { producto?: ProductoRow } | undefined)?.producto;
  if (!data) return null;
  return rowToProducto(data);
}

/** Actualiza solo precio_venta y/o costo_promedio. Wrapper de updateProducto. */
export async function updateProductoPrecios(
  productoId: string,
  datos: { precio_venta?: number; costo_promedio?: number }
): Promise<void> {
  await updateProducto(productoId, datos);
}

/** Actualiza producto via API server-side (PATCH /api/productos/[id]). */
export async function updateProducto(
  id: string,
  datos: Partial<Omit<Producto, "id">>
): Promise<Producto | null> {
  const body: Record<string, unknown> = {};
  if (datos.nombre !== undefined) body.nombre = datos.nombre;
  if (datos.sku !== undefined) body.sku = datos.sku;
  if (datos.costo_promedio !== undefined) body.costo_promedio = datos.costo_promedio;
  if (datos.precio_venta !== undefined) body.precio_venta = datos.precio_venta;
  if (datos.precio_mayorista !== undefined) body.precio_mayorista = datos.precio_mayorista ?? null;
  if (datos.cantidad_minima_mayorista !== undefined) body.cantidad_minima_mayorista = datos.cantidad_minima_mayorista ?? null;
  if (datos.precio_distribuidor !== undefined) body.precio_distribuidor = datos.precio_distribuidor ?? null;
  if (datos.stock_actual !== undefined) body.stock_actual = datos.stock_actual;
  if (datos.stock_minimo !== undefined) body.stock_minimo = datos.stock_minimo;
  if (datos.unidad_medida !== undefined) body.unidad_medida = datos.unidad_medida;
  if (datos.metodo_valuacion !== undefined) body.metodo_valuacion = datos.metodo_valuacion;
  if (datos.codigo_barras !== undefined) body.codigo_barras = datos.codigo_barras ?? null;
  if (datos.codigo_barras_interno !== undefined) body.codigo_barras_interno = datos.codigo_barras_interno;
  if (datos.imagen_path !== undefined) body.imagen_path = datos.imagen_path ?? null;
  if (datos.imagen_url !== undefined) body.imagen_url = datos.imagen_url ?? null;
  if (datos.categoria_principal_id !== undefined) body.categoria_principal_id = datos.categoria_principal_id ?? null;
  if (datos.ubicacion_principal_id !== undefined) body.ubicacion_principal_id = datos.ubicacion_principal_id ?? null;
  if (datos.proveedor_principal_id !== undefined) body.proveedor_principal_id = datos.proveedor_principal_id ?? null;
  if (typeof datos.es_vendible === "boolean") body.es_vendible = datos.es_vendible;
  if (typeof datos.es_insumo === "boolean") body.es_insumo = datos.es_insumo;
  if (typeof datos.controla_stock === "boolean") body.controla_stock = datos.controla_stock;
  if (typeof datos.destacado === "boolean") body.destacado = datos.destacado;
  if (typeof datos.oferta_semana_destacada === "boolean") body.oferta_semana_destacada = datos.oferta_semana_destacada;
  if (datos.discount_type !== undefined) {
    body.discount_type =
      datos.discount_type === "percentage" || datos.discount_type === "fixed"
        ? datos.discount_type
        : null;
  }
  if (datos.discount_value !== undefined)
    body.discount_value = datos.discount_value ?? 0;
  if (datos.discount_starts_at !== undefined)
    body.discount_starts_at = datos.discount_starts_at ?? null;
  if (datos.discount_ends_at !== undefined)
    body.discount_ends_at = datos.discount_ends_at ?? null;
  if (typeof datos.valorizado === "boolean") body.valorizado = datos.valorizado;
  if (datos.unidad_compra !== undefined) body.unidad_compra = datos.unidad_compra ?? null;
  if (datos.unidad_receta !== undefined) body.unidad_receta = datos.unidad_receta ?? null;
  if (typeof datos.factor_compra_receta === "number" && datos.factor_compra_receta > 0)
    body.factor_compra_receta = datos.factor_compra_receta;
  if (typeof datos.tiempo_prep_minutos === "number" && datos.tiempo_prep_minutos >= 0)
    body.tiempo_prep_minutos = datos.tiempo_prep_minutos;
  if (datos.descripcion !== undefined) body.descripcion = datos.descripcion;
  if (datos.modo_receta !== undefined) body.modo_receta = datos.modo_receta;

  const res = await fetch(`/api/productos/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
  });
  const json = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok || !json?.success) {
    const msg = (json as { error?: string })?.error ?? `Error ${res.status} al actualizar producto.`;
    if (res.status === 409 || res.status === 400 || res.status === 404) throw new Error(msg);
    console.error("[inventario] updateProducto:", msg);
    throw new Error(msg);
  }

  const data = (json.data as { producto?: ProductoRow } | undefined)?.producto;
  if (!data) return null;
  return rowToProducto(data);
}

// ─── Movimientos ─────────────────────────────────────────────────────────────

/** Lista movimientos via API server-side (PG directo). */
export async function getMovimientos(): Promise<MovimientoInventario[]> {
  try {
    const r = await fetch("/api/inventario/movimientos", { credentials: "include", cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) {
      console.error("[inventario] getMovimientos:", (j as { error?: string })?.error ?? r.status);
      return [];
    }
    const list = ((j.data as { movimientos?: MovimientoRow[] }).movimientos ?? []) as MovimientoRow[];
    return list.map(rowToMovimiento);
  } catch (err) {
    console.error("[inventario] getMovimientos:", err instanceof Error ? err.message : err);
    return [];
  }
}

export interface MovimientosPaginadosOpts {
  page?: number;
  pageSize?: number;
  q?: string;
  tipo?: string;     // ENTRADA | SALIDA | AJUSTE
  origen?: string;   // compra | venta | ajuste_manual | inventario_inicial
  fechaDesde?: string;  // YYYY-MM-DD
  fechaHasta?: string;  // YYYY-MM-DD
}
export interface MovimientosPaginadosResult {
  movimientos: MovimientoInventario[];
  total: number;
}

/**
 * Lista movimientos paginados con filtros server-side. Mismo modelo que
 * getProductosPaginated. El total viene de count: "planned" (estimacion
 * rapida via pg_stats).
 */
export async function getMovimientosPaginated(
  opts: MovimientosPaginadosOpts = {}
): Promise<MovimientosPaginadosResult> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.max(1, Math.min(200, opts.pageSize ?? 25));
  const offset = (page - 1) * pageSize;
  const params = new URLSearchParams();
  params.set("limit", String(pageSize));
  params.set("offset", String(offset));
  if (opts.q && opts.q.trim()) params.set("q", opts.q.trim());
  if (opts.tipo) params.set("tipo", opts.tipo);
  if (opts.origen) params.set("origen", opts.origen);
  if (opts.fechaDesde) params.set("fecha_desde", opts.fechaDesde);
  if (opts.fechaHasta) params.set("fecha_hasta", opts.fechaHasta);
  try {
    const r = await fetch(`/api/inventario/movimientos?${params.toString()}`, {
      credentials: "include",
      cache: "no-store",
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) {
      console.error("[inventario] getMovimientosPaginated:", (j as { error?: string })?.error ?? r.status);
      return { movimientos: [], total: 0 };
    }
    const data = j.data as { movimientos?: MovimientoRow[]; total?: number };
    const list = (data.movimientos ?? []) as MovimientoRow[];
    return { movimientos: list.map(rowToMovimiento), total: Number(data.total) || 0 };
  } catch (err) {
    console.error("[inventario] getMovimientosPaginated:", err instanceof Error ? err.message : err);
    return { movimientos: [], total: 0 };
  }
}

function calcularDelta(tipo: TipoMovimiento, cantidad: number): number {
  if (tipo === "ENTRADA") return Math.abs(cantidad);
  if (tipo === "SALIDA") return -Math.abs(cantidad);
  return cantidad; // AJUSTE: la cantidad ya lleva el signo
}

export type NuevoMovimientoData = Omit<MovimientoInventario, "id">;

/**
 * Registra un movimiento y actualiza stock_actual del producto.
 * empresa_id se obtiene del usuario; RLS valida acceso.
 */
export async function saveMovimiento(
  mov: NuevoMovimientoData
): Promise<MovimientoInventario | null> {
  const supabase = await getBrowserSupabaseForEmpresaData();
  const usuario = await getCurrentUser();
  if (!usuario?.empresa_id) throw new Error("Usuario no autenticado o sin empresa");

  // 1. Obtener producto actual
  const producto = await getProducto(mov.producto_id);
  if (!producto) {
    console.error("[inventario] saveMovimiento: producto no encontrado");
    return null;
  }

  const delta = calcularDelta(mov.tipo, mov.cantidad);
  const nuevoStock = Math.max(0, producto.stock_actual + delta);
  const debeActualizarStock = mov.origen !== "inventario_inicial"; // inventario_inicial ya viene del insert

  // 2. Insertar movimiento
  const insert = {
    empresa_id: usuario.empresa_id,
    producto_id: mov.producto_id,
    producto_nombre: mov.producto_nombre,
    producto_sku: mov.producto_sku,
    tipo: mov.tipo,
    cantidad: mov.cantidad,
    costo_unitario: mov.costo_unitario,
    origen: mov.origen,
    referencia: mov.referencia ?? null,
    fecha: mov.fecha,
  };

  const { data: movData, error: movError } = await supabase
    .from("movimientos_inventario")
    .insert([insert])
    .select()
    .single();

  if (movError) {
    console.error("[inventario] saveMovimiento:", movError.message);
    return null;
  }

  // 3. Actualizar stock del producto (salvo inventario_inicial, que ya está en el insert)
  if (debeActualizarStock) {
    const { error: updError } = await supabase
      .from("productos")
      .update({ stock_actual: nuevoStock })
      .eq("id", mov.producto_id);

    if (updError) {
      console.error("[inventario] saveMovimiento (update stock):", updError.message);
    }
  }

  return rowToMovimiento(movData as MovimientoRow);
}
