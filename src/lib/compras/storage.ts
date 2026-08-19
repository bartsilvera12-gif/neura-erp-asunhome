import type { Compra } from "./types";

interface CompraApiRow {
  id: string; numero_control: string; proveedor_id: string; proveedor_nombre: string;
  producto_id: string; producto_nombre: string; cantidad: string | number; moneda: string;
  tipo_cambio: string | number; costo_unitario_original: string | number;
  costo_unitario: string | number; iva_tipo: string;
  subtotal: string | number; monto_iva: string | number; total: string | number;
  precio_venta: string | number; margen_venta: string | number | null;
  tipo_pago: string; plazo_dias: number | null; nro_timbrado: string; estado: string;
  fecha: string;
  numero_factura?: string | null;
  fecha_factura?: string | null;
  observacion?: string | null;
  orden_compra_numero?: string | null;
  orden_compra_item_id?: string | null;
  comprobante_storage_path?: string | null;
  comprobante_nombre?: string | null;
  comprobante_mime_type?: string | null;
  anulada_at?: string | null;
  anulada_motivo?: string | null;
}

function mapRow(r: CompraApiRow): Compra {
  return {
    id: r.id,
    numero_control: r.numero_control,
    proveedor_id: r.proveedor_id,
    proveedor_nombre: r.proveedor_nombre,
    producto_id: r.producto_id,
    producto_nombre: r.producto_nombre,
    cantidad: Number(r.cantidad),
    moneda: (r.moneda === "USD" ? "USD" : "PYG") as Compra["moneda"],
    tipo_cambio: Number(r.tipo_cambio),
    costo_unitario_original: Number(r.costo_unitario_original),
    costo_unitario: Number(r.costo_unitario),
    iva_tipo: r.iva_tipo as Compra["iva_tipo"],
    subtotal: Number(r.subtotal),
    monto_iva: Number(r.monto_iva),
    total: Number(r.total),
    precio_venta: Number(r.precio_venta),
    margen_venta: r.margen_venta != null ? Number(r.margen_venta) : 0,
    tipo_pago: r.tipo_pago as Compra["tipo_pago"],
    plazo_dias: r.plazo_dias ?? undefined,
    nro_timbrado: r.nro_timbrado,
    numero_factura: r.numero_factura ?? null,
    fecha_factura: r.fecha_factura ?? null,
    observacion: r.observacion ?? null,
    orden_compra_numero: r.orden_compra_numero ?? null,
    orden_compra_item_id: r.orden_compra_item_id ?? null,
    comprobante_storage_path: r.comprobante_storage_path ?? null,
    comprobante_nombre: r.comprobante_nombre ?? null,
    comprobante_mime_type: r.comprobante_mime_type ?? null,
    anulada_at: r.anulada_at ?? null,
    anulada_motivo: r.anulada_motivo ?? null,
    fecha: r.fecha,
  };
}

export async function getCompras(): Promise<Compra[]> {
  try {
    const r = await fetch("/api/compras", { credentials: "include", cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) {
      console.error("[compras] getCompras:", (j as { error?: string })?.error ?? r.status);
      return [];
    }
    const list = ((j.data as { compras?: CompraApiRow[] }).compras ?? []) as CompraApiRow[];
    return list.map(mapRow);
  } catch (e) {
    console.error("[compras] getCompras:", e);
    return [];
  }
}

export interface SaveCompraResult {
  success: true;
  compra: Compra;
  warning?: string | null;
}
export interface SaveCompraError {
  success: false;
  error: string;
}

// ── Compra multiproducto ────────────────────────────────────────────────────

export interface CompraItemPayload {
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
export interface CompraHeaderPayload {
  proveedor_id: string;
  proveedor_nombre: string;
  moneda: "PYG" | "USD";
  tipo_cambio: number;
  tipo_pago: "contado" | "credito";
  plazo_dias?: number;
  nro_timbrado: string;
  numero_factura?: string | null;
  fecha_factura?: string | null;
  fecha?: string | null;
  orden_compra_numero?: string | null;
  comprobante_storage_path?: string | null;
  comprobante_nombre?: string | null;
  comprobante_mime_type?: string | null;
  descuenta_caja?: boolean;
}

export interface UploadComprobanteResult {
  comprobante_storage_path: string;
  comprobante_nombre: string;
  comprobante_mime_type: string;
}

/** Sube el comprobante (imagen/PDF) y devuelve su referencia para asociarla a la compra. */
export async function uploadComprobante(
  file: File
): Promise<{ ok: true; data: UploadComprobanteResult } | { ok: false; error: string }> {
  try {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/compras/comprobante/upload", {
      method: "POST",
      credentials: "include",
      body: fd,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) {
      return { ok: false, error: (j as { error?: string })?.error ?? `Error ${r.status} al subir el comprobante.` };
    }
    return { ok: true, data: j.data as UploadComprobanteResult };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error de red al subir el comprobante." };
  }
}
export interface SaveComprasMultiResult {
  success: true;
  numero_control: string;
  compras: Compra[];
  warning?: string | null;
}

/** Guarda una compra con N líneas (un solo numero_control). */
export async function saveCompraMulti(
  header: CompraHeaderPayload,
  items: CompraItemPayload[]
): Promise<SaveComprasMultiResult | SaveCompraError> {
  try {
    const r = await fetch("/api/compras", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...header, items }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) {
      const err = (j as { error?: string })?.error ?? `Error ${r.status} al guardar la compra.`;
      console.error("[compras] saveCompraMulti:", err);
      return { success: false, error: err };
    }
    const data = j.data as { numero_control?: string; compras?: CompraApiRow[]; warning?: string | null };
    return {
      success: true,
      numero_control: data.numero_control ?? "",
      compras: (data.compras ?? []).map(mapRow),
      warning: data.warning ?? null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error de red";
    console.error("[compras] saveCompraMulti:", e);
    return { success: false, error: msg };
  }
}

export async function saveCompra(
  datos: Omit<Compra, "id" | "numero_control" | "fecha">
): Promise<SaveCompraResult | SaveCompraError> {
  try {
    const r = await fetch("/api/compras", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datos),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) {
      const err = (j as { error?: string })?.error ?? `Error ${r.status} al guardar la compra.`;
      console.error("[compras] saveCompra:", err);
      return { success: false, error: err };
    }
    const data = j.data as { compra?: CompraApiRow; warning?: string | null };
    if (!data.compra) {
      return { success: false, error: "Respuesta inválida del servidor." };
    }
    return { success: true, compra: mapRow(data.compra), warning: data.warning ?? null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error de red";
    console.error("[compras] saveCompra:", e);
    return { success: false, error: msg };
  }
}
