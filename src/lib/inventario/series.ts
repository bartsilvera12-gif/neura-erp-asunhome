/** Cliente de números de serie (browser). */

export type SerieEstado =
  | "en_stock" | "reservado" | "vendido" | "averiado"
  | "en_servicio" | "devuelto_proveedor" | "baja";

export interface Serie {
  id: string;
  producto_id: string;
  producto_nombre: string | null;
  sku: string | null;
  numero_serie: string;
  estado: SerieEstado;
  ubicacion_id: string | null;
  ubicacion_nombre: string | null;
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  compra_id: string | null;
  venta_id: string | null;
  cliente_id: string | null;
  cliente_nombre: string | null;
  costo_unitario: number | null;
  precio_venta: number | null;
  fecha_ingreso: string;
  fecha_venta: string | null;
  garantia_hasta: string | null;
  observaciones: string | null;
}

export const SERIE_ESTADO_LABEL: Record<SerieEstado, string> = {
  en_stock: "En stock",
  reservado: "Reservado",
  vendido: "Vendido",
  averiado: "Averiado",
  en_servicio: "En el técnico",
  devuelto_proveedor: "Devuelto al proveedor",
  baja: "Baja",
};

export type Res<T> = { ok: true; data: T } | { ok: false; error: string };

async function call<T>(url: string, init: RequestInit, pick: (d: Record<string, unknown>) => T): Promise<Res<T>> {
  try {
    const r = await fetch(url, { credentials: "include", ...init });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) return { ok: false, error: j?.error ?? `Error ${r.status}` };
    return { ok: true, data: pick(j.data as Record<string, unknown>) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error de red" };
  }
}

export async function getSeries(opts: { producto?: string; estado?: SerieEstado; q?: string } = {}): Promise<Serie[]> {
  const sp = new URLSearchParams();
  if (opts.producto) sp.set("producto", opts.producto);
  if (opts.estado) sp.set("estado", opts.estado);
  if (opts.q) sp.set("q", opts.q);
  const res = await call<Serie[]>(`/api/series?${sp.toString()}`, { cache: "no-store" }, (d) => (d.filas as Serie[]) ?? []);
  return res.ok ? res.data : [];
}

export async function getSeriesDisponibles(productoId: string): Promise<Serie[]> {
  const res = await call<Serie[]>(`/api/series?disponibles=1&producto=${productoId}`, { cache: "no-store" }, (d) => (d.filas as Serie[]) ?? []);
  return res.ok ? res.data : [];
}

export interface SerieNueva {
  numero_serie: string;
  proveedor_id?: string | null;
  observaciones?: string | null;
  garantia_hasta?: string | null;
}

export function cargarSeries(productoId: string, series: SerieNueva[]): Promise<Res<{ creadas: number; duplicadas: string[] }>> {
  return call(`/api/series`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ producto_id: productoId, series }),
  }, (d) => d as unknown as { creadas: number; duplicadas: string[] });
}

export function borrarSerie(id: string): Promise<Res<{ id: string }>> {
  return call(`/api/series`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  }, (d) => d as unknown as { id: string });
}
