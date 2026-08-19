import type { OrdenCompra } from "./types";

interface OrdenApiRow {
  id: string; numero_oc: string; proveedor_id: string; proveedor_nombre: string;
  producto_id: string; producto_nombre: string; cantidad: string | number;
  cantidad_recibida: string | number; moneda: string;
  tipo_cambio: string | number; costo_unitario_original: string | number;
  costo_unitario: string | number; iva_tipo: string;
  subtotal: string | number; monto_iva: string | number; total: string | number;
  precio_venta: string | number; margen_venta: string | number | null;
  tipo_pago: string; plazo_dias: number | null; estado: string; observacion: string | null;
  compra_numero_control: string | null; recibida_at: string | null;
  cancelada_at: string | null; cancelada_motivo: string | null; fecha: string;
}

function mapRow(r: OrdenApiRow): OrdenCompra {
  const cantidad = Number(r.cantidad);
  const cantidadRecibida = Number(r.cantidad_recibida) || 0;
  return {
    id: r.id,
    numero_oc: r.numero_oc,
    proveedor_id: r.proveedor_id,
    proveedor_nombre: r.proveedor_nombre,
    producto_id: r.producto_id,
    producto_nombre: r.producto_nombre,
    cantidad,
    cantidad_recibida: cantidadRecibida,
    cantidad_pendiente: Math.max(0, cantidad - cantidadRecibida),
    moneda: (r.moneda === "USD" ? "USD" : "PYG") as OrdenCompra["moneda"],
    tipo_cambio: Number(r.tipo_cambio),
    costo_unitario_original: Number(r.costo_unitario_original),
    costo_unitario: Number(r.costo_unitario),
    iva_tipo: r.iva_tipo as OrdenCompra["iva_tipo"],
    subtotal: Number(r.subtotal),
    monto_iva: Number(r.monto_iva),
    total: Number(r.total),
    precio_venta: Number(r.precio_venta),
    margen_venta: r.margen_venta != null ? Number(r.margen_venta) : 0,
    tipo_pago: r.tipo_pago as OrdenCompra["tipo_pago"],
    plazo_dias: r.plazo_dias ?? undefined,
    estado: r.estado as OrdenCompra["estado"],
    observacion: r.observacion ?? null,
    compra_numero_control: r.compra_numero_control ?? null,
    recibida_at: r.recibida_at ?? null,
    cancelada_at: r.cancelada_at ?? null,
    cancelada_motivo: r.cancelada_motivo ?? null,
    fecha: r.fecha,
  };
}

export async function getOrdenesCompra(): Promise<OrdenCompra[]> {
  try {
    const r = await fetch("/api/ordenes-compra", { credentials: "include", cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) return [];
    return (((j.data as { ordenes?: OrdenApiRow[] }).ordenes ?? []) as OrdenApiRow[]).map(mapRow);
  } catch (e) {
    console.error("[ordenes-compra] getOrdenesCompra:", e);
    return [];
  }
}

export async function getOrdenCompra(numeroOc: string): Promise<OrdenCompra[]> {
  try {
    const r = await fetch(`/api/ordenes-compra/${encodeURIComponent(numeroOc)}`, {
      credentials: "include", cache: "no-store",
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) return [];
    return (((j.data as { ordenes?: OrdenApiRow[] }).ordenes ?? []) as OrdenApiRow[]).map(mapRow);
  } catch (e) {
    console.error("[ordenes-compra] getOrdenCompra:", e);
    return [];
  }
}

export interface OrdenItemPayload {
  producto_id: string;
  producto_nombre: string;
  cantidad: number;
  costo_unitario: number;
  costo_unitario_original: number;
  iva_tipo: string;
  subtotal: number;
  monto_iva: number;
  total: number;
  precio_venta: number;
  margen_venta: number | null;
}
export interface OrdenHeaderPayload {
  proveedor_id: string;
  proveedor_nombre: string;
  moneda: "PYG" | "USD";
  tipo_cambio: number;
  tipo_pago: "contado" | "credito";
  plazo_dias?: number;
  observacion?: string | null;
}

interface OkOrden { success: true; numero_oc: string; ordenes: OrdenCompra[]; }
interface ErrOrden { success: false; error: string; }

export async function saveOrdenCompra(
  header: OrdenHeaderPayload,
  items: OrdenItemPayload[]
): Promise<OkOrden | ErrOrden> {
  try {
    const r = await fetch("/api/ordenes-compra", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...header, items }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) {
      return { success: false, error: (j as { error?: string })?.error ?? `Error ${r.status}` };
    }
    const data = j.data as { numero_oc?: string; ordenes?: OrdenApiRow[] };
    return { success: true, numero_oc: data.numero_oc ?? "", ordenes: (data.ordenes ?? []).map(mapRow) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error de red" };
  }
}

export async function updateOrdenCompra(
  numeroOc: string,
  header: OrdenHeaderPayload,
  items: OrdenItemPayload[]
): Promise<OkOrden | ErrOrden> {
  try {
    const r = await fetch(`/api/ordenes-compra/${encodeURIComponent(numeroOc)}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...header, items }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) {
      return { success: false, error: (j as { error?: string })?.error ?? `Error ${r.status}` };
    }
    const data = j.data as { numero_oc?: string; ordenes?: OrdenApiRow[] };
    return { success: true, numero_oc: data.numero_oc ?? numeroOc, ordenes: (data.ordenes ?? []).map(mapRow) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error de red" };
  }
}

export async function deleteOrdenCompra(
  numeroOc: string
): Promise<{ success: true } | ErrOrden> {
  try {
    const r = await fetch(`/api/ordenes-compra/${encodeURIComponent(numeroOc)}`, {
      method: "DELETE",
      credentials: "include",
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) return { success: false, error: (j as { error?: string })?.error ?? `Error ${r.status}` };
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error de red" };
  }
}

export async function cancelarOrdenCompra(
  numeroOc: string,
  motivo: string | null
): Promise<{ success: true } | ErrOrden> {
  try {
    const r = await fetch(`/api/ordenes-compra/${encodeURIComponent(numeroOc)}/cancelar`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ motivo }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) return { success: false, error: (j as { error?: string })?.error ?? `Error ${r.status}` };
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error de red" };
  }
}

export interface RecepcionItemPayload {
  orden_item_id: string;
  cantidad_recibida: number;
  observacion?: string | null;
}

export interface ConfirmarRecepcionPayload {
  numero_factura: string;
  nro_timbrado: string;
  fecha_factura?: string | null;
  observacion?: string | null;
  tipo_pago: "contado" | "credito";
  plazo_dias?: number;
  comprobante_storage_path?: string | null;
  comprobante_nombre?: string | null;
  comprobante_mime_type?: string | null;
  items: RecepcionItemPayload[];
  permitir_excedente?: boolean;
}

export interface ExcedenteDetalle { producto_nombre: string; pendiente: number; intentado: number }

export type ConfirmarRecepcionResult =
  | { success: true; numero_control: string; estado_oc: "recibida_parcial" | "recibida_total"; warning?: string | null }
  | { success: false; error: string; excedentes?: ExcedenteDetalle[] };

/** Confirma la recepción (parcial o total) de una OC. Puede llamarse varias veces. */
export async function confirmarRecepcionOrdenCompra(
  numeroOc: string,
  payload: ConfirmarRecepcionPayload
): Promise<ConfirmarRecepcionResult> {
  try {
    const r = await fetch(`/api/ordenes-compra/${encodeURIComponent(numeroOc)}/recibir`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) {
      return {
        success: false,
        error: (j as { error?: string })?.error ?? `Error ${r.status}`,
        excedentes: (j as { excedentes?: ExcedenteDetalle[] })?.excedentes,
      };
    }
    const data = j.data as { numero_control?: string; estado_oc?: string; warning?: string | null };
    return {
      success: true,
      numero_control: data.numero_control ?? "",
      estado_oc: data.estado_oc === "recibida_total" ? "recibida_total" : "recibida_parcial",
      warning: data.warning ?? null,
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error de red" };
  }
}
