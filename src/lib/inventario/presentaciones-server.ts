/**
 * Helpers server-side para presentaciones de producto.
 */
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import type {
  ProductoPresentacion,
  ProductoPresentacionInput,
} from "./presentaciones-types";

export const PRESENTACION_COLS =
  "id, empresa_id, producto_id, nombre, cantidad_base, precio_venta, es_default, activo, created_at, updated_at";

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function mapPresentacion(r: Record<string, unknown>): ProductoPresentacion {
  return {
    id: String(r.id),
    empresa_id: String(r.empresa_id),
    producto_id: String(r.producto_id),
    nombre: String(r.nombre ?? ""),
    cantidad_base: num(r.cantidad_base),
    precio_venta: numOrNull(r.precio_venta),
    es_default: r.es_default === true,
    activo: r.activo === true,
    created_at: String(r.created_at ?? ""),
    updated_at: String(r.updated_at ?? ""),
  };
}

/**
 * Resuelve la presentacion default ACTIVA de un producto. Util en
 * create-venta cuando el cliente no manda presentacion_id explicito.
 *
 * Devuelve null si el producto no tiene ninguna (no deberia pasar tras el
 * backfill — defensive).
 */
export async function getDefaultPresentacion(
  sb: AppSupabaseClient,
  empresaId: string,
  productoId: string
): Promise<ProductoPresentacion | null> {
  const { data } = await sb
    .from("producto_presentaciones")
    .select(PRESENTACION_COLS)
    .eq("empresa_id", empresaId)
    .eq("producto_id", productoId)
    .eq("activo", true)
    .eq("es_default", true)
    .maybeSingle();
  return data ? mapPresentacion(data as Record<string, unknown>) : null;
}

/**
 * Carga presentaciones por ids (batch). Devuelve un Map id -> presentacion.
 * Se usa en create-venta para validar y snapshotear los items.
 */
export async function getPresentacionesByIds(
  sb: AppSupabaseClient,
  empresaId: string,
  ids: string[]
): Promise<Map<string, ProductoPresentacion>> {
  if (ids.length === 0) return new Map();
  const { data } = await sb
    .from("producto_presentaciones")
    .select(PRESENTACION_COLS)
    .eq("empresa_id", empresaId)
    .in("id", ids);
  const map = new Map<string, ProductoPresentacion>();
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const p = mapPresentacion(r);
    map.set(p.id, p);
  }
  return map;
}

/**
 * Crea la presentacion default "Unidad" para un producto recien creado. Se
 * invoca despues de insertar el producto para mantener la convencion de que
 * TODO producto siempre tiene al menos una presentacion activa.
 *
 * Idempotente: si ya existe una presentacion para el producto, no hace nada.
 */
export async function ensureDefaultPresentacion(
  sb: AppSupabaseClient,
  empresaId: string,
  productoId: string,
  unidadBase: string | null
): Promise<void> {
  const ex = await sb
    .from("producto_presentaciones")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("producto_id", productoId)
    .limit(1)
    .maybeSingle();
  if (ex.data) return;
  await sb.from("producto_presentaciones").insert({
    empresa_id: empresaId,
    producto_id: productoId,
    nombre: (unidadBase ?? "").trim() || "Unidad",
    cantidad_base: 1,
    precio_venta: null,
    es_default: true,
    activo: true,
  });
}

/**
 * Aplica el patch de "es_default unico". Si el caller marca esta
 * presentacion como default, desmarca a las demas del mismo producto en una
 * sola transaccion logica. No usa transaccion explicita PG (PostgREST no
 * la expone), pero el indice unique parcial previene races a nivel DB.
 */
export async function setAsDefault(
  sb: AppSupabaseClient,
  empresaId: string,
  productoId: string,
  presentacionId: string
): Promise<void> {
  // 1) Desmarcar las demas del mismo producto
  await sb
    .from("producto_presentaciones")
    .update({ es_default: false })
    .eq("empresa_id", empresaId)
    .eq("producto_id", productoId)
    .neq("id", presentacionId);
  // 2) Marcar esta como default + activa (forzar activa porque default
  //    inactiva no tiene sentido)
  await sb
    .from("producto_presentaciones")
    .update({ es_default: true, activo: true })
    .eq("empresa_id", empresaId)
    .eq("id", presentacionId);
}

/**
 * Valida el input de creacion/edicion. Retorna error humano-leible o null.
 */
export function validatePresentacionInput(
  input: Partial<ProductoPresentacionInput>
): string | null {
  const nombre = (input.nombre ?? "").trim();
  if (!nombre) return "El nombre es obligatorio.";
  if (nombre.length > 60) return "El nombre es demasiado largo (máx. 60).";
  const cb = Number(input.cantidad_base);
  if (!Number.isFinite(cb) || cb <= 0) {
    return "La cantidad base debe ser mayor a 0.";
  }
  if (input.precio_venta != null) {
    const pv = Number(input.precio_venta);
    if (!Number.isFinite(pv) || pv < 0) {
      return "El precio debe ser >= 0.";
    }
  }
  return null;
}
