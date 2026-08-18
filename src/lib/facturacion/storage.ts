import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { getBrowserSupabaseForEmpresaData } from "@/lib/supabase/browser-data-client";
import { getCurrentUser } from "@/lib/auth";
import type { Suscripcion, FacturaItem, Pago } from "./types";
import type { Factura } from "@/lib/gestion-clientes/types";
import { getFacturas } from "@/lib/gestion-clientes/storage";
import { fechaVencimientoSuscripcion, hoyYmdLocal } from "@/lib/fechas/calendario";

// ─── Tipos de fila ───────────────────────────────────────────────────────────

interface SuscripcionRow {
  id: string;
  empresa_id: string;
  cliente_id: string;
  plan_id: string | null;
  precio: number;
  moneda: string;
  fecha_inicio: string;
  duracion_meses: number;
  dia_facturacion: number;
  dia_vencimiento: number;
  estado: string;
  generar_factura_este_mes: boolean;
  created_at: string;
  planes?: { nombre: string } | { nombre: string }[] | null;
}

function planNombreDesdeRow(r: SuscripcionRow): string | undefined {
  const p = r.planes;
  if (!p) return undefined;
  if (Array.isArray(p)) return p[0]?.nombre?.trim() || undefined;
  return typeof p.nombre === "string" ? p.nombre.trim() || undefined : undefined;
}

interface FacturaItemRow {
  id: string;
  factura_id: string;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  iva: number;
  total: number;
}

interface PagoRow {
  id: string;
  factura_id: string;
  monto: number;
  fecha_pago: string;
  metodo_pago: string;
  referencia: string | null;
  created_at: string;
}

// ─── Suscripciones ───────────────────────────────────────────────────────────

/** Lista suscripciones vía API tenant (mismo schema que facturas); evita PostgREST browser + schema cache. */
export async function getSuscripciones(clienteId: string): Promise<Suscripcion[]> {
  if (typeof window === "undefined") return [];
  try {
    const qs = new URLSearchParams({ cliente_id: clienteId });
    const res = await fetchWithSupabaseSession(`/api/suscripciones?${qs.toString()}`, { cache: "no-store" });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.error("[facturacion] getSuscripciones API:", res.status, t.slice(0, 400));
      return [];
    }
    const json = (await res.json()) as { success?: boolean; data?: unknown };
    if (!json.success || !Array.isArray(json.data)) return [];
    const rows = json.data as SuscripcionRow[];
    if (process.env.NODE_ENV === "development") {
      console.info("[facturacion] getSuscripciones", { clienteId, count: rows.length });
    }
    return rows.map((r) => ({
      id: r.id,
      cliente_id: r.cliente_id,
      plan_id: r.plan_id,
      plan_nombre: planNombreDesdeRow(r),
      precio: Number(r.precio),
      moneda: r.moneda as "GS" | "USD",
      fecha_inicio: r.fecha_inicio,
      duracion_meses: r.duracion_meses,
      dia_facturacion: r.dia_facturacion,
      dia_vencimiento: r.dia_vencimiento,
      estado: r.estado as Suscripcion["estado"],
      generar_factura_este_mes: Boolean(r.generar_factura_este_mes),
      created_at: r.created_at,
    }));
  } catch (e) {
    console.error("[facturacion] getSuscripciones:", e);
    return [];
  }
}

export type NuevaSuscripcionData = {
  cliente_id: string;
  plan_id: string | null;
  precio: number;
  moneda: "GS" | "USD";
  fecha_inicio: string;
  duracion_meses: number;
  dia_facturacion: number;
  dia_vencimiento: number;
  generar_factura_este_mes: boolean;
};

export async function saveSuscripcion(
  datos: NuevaSuscripcionData,
  planNombre?: string
): Promise<Suscripcion | null> {
  const supabase = await getBrowserSupabaseForEmpresaData();
  const usuario = await getCurrentUser();
  if (!usuario?.empresa_id) throw new Error("Usuario no autenticado o sin empresa");

  const insert = {
    empresa_id: usuario.empresa_id,
    cliente_id: datos.cliente_id,
    plan_id: datos.plan_id,
    precio: datos.precio,
    moneda: datos.moneda,
    fecha_inicio: datos.fecha_inicio,
    duracion_meses: datos.duracion_meses,
    dia_facturacion: datos.dia_facturacion,
    dia_vencimiento: datos.dia_vencimiento,
    generar_factura_este_mes: datos.generar_factura_este_mes,
  };

  const { data, error } = await supabase
    .from("suscripciones")
    .insert([insert])
    .select()
    .single();

  if (error) {
    console.error("[facturacion] saveSuscripcion:", error.message);
    return null;
  }

  const suscripcion = data as SuscripcionRow;

  if (datos.generar_factura_este_mes) {
    await generarFacturaDesdeSuscripcion(suscripcion, planNombre ?? "Servicio");
  }

  // Si el plan es de marketing, marcar cliente como tipo_servicio_cliente = marketing
  if (datos.plan_id) {
    const { data: plan } = await supabase
      .from("planes")
      .select("es_plan_marketing")
      .eq("id", datos.plan_id)
      .maybeSingle();
    if (plan?.es_plan_marketing) {
      await supabase
        .from("clientes")
        .update({ tipo_servicio_cliente: "marketing" })
        .eq("id", datos.cliente_id)
        .eq("empresa_id", usuario.empresa_id);
    }
  }

  return {
    id: suscripcion.id,
    cliente_id: suscripcion.cliente_id,
    plan_id: suscripcion.plan_id,
    plan_nombre: planNombre,
    precio: Number(suscripcion.precio),
    moneda: suscripcion.moneda as "GS" | "USD",
    fecha_inicio: suscripcion.fecha_inicio,
    duracion_meses: suscripcion.duracion_meses,
    dia_facturacion: suscripcion.dia_facturacion,
    dia_vencimiento: suscripcion.dia_vencimiento,
    estado: suscripcion.estado as Suscripcion["estado"],
    generar_factura_este_mes: Boolean(suscripcion.generar_factura_este_mes),
    created_at: suscripcion.created_at,
  };
}

async function generarFacturaDesdeSuscripcion(
  suscripcion: SuscripcionRow,
  planNombre: string
): Promise<Factura | null> {
  const supabase = await getBrowserSupabaseForEmpresaData();
  const hoy = hoyYmdLocal();
  const diaVencCfg = Math.min(Math.max(1, suscripcion.dia_vencimiento), 31);
  const fechaVenc = fechaVencimientoSuscripcion(hoy, diaVencCfg);

  const total = Number(suscripcion.precio);
  const res = await fetchWithSupabaseSession("/api/facturas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cliente_id: suscripcion.cliente_id,
      fecha: hoy,
      fecha_vencimiento: fechaVenc,
      monto: total,
      tipo: "suscripcion",
      moneda: suscripcion.moneda as "GS" | "USD",
      descripcion_linea: planNombre,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { success?: boolean; data?: Factura };
  if (!res.ok || !json.success || !json.data) return null;
  const factura = json.data;

  const { error: errUpd } = await supabase
    .from("facturas")
    .update({ suscripcion_id: suscripcion.id })
    .eq("id", factura.id);

  if (errUpd) console.error("[facturacion] facturas.suscripcion_id:", errUpd.message);
  return factura;
}

export type IvaTipoFactura = "exenta" | "iva_5" | "iva_10";

/** Crea factura inicial para cliente Contado (venta al contado). */
export async function crearFacturaContado(
  clienteId: string,
  monto: number,
  descripcion: string,
  moneda: "GS" | "USD" = "GS",
  ivaTipo: IvaTipoFactura = "iva_10"
): Promise<Factura | null> {
  const hoy = hoyYmdLocal();
  const res = await fetchWithSupabaseSession("/api/facturas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cliente_id: clienteId,
      fecha: hoy,
      fecha_vencimiento: hoy,
      monto,
      tipo: "contado",
      moneda,
      descripcion_linea: descripcion || "Venta al contado",
      iva_tipo: ivaTipo,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { success?: boolean; data?: Factura };
  if (!res.ok || !json.success || !json.data) return null;
  return json.data;
}

// ─── Facturas (re-export + get por cliente) ──────────────────────────────────

export { getFacturas } from "@/lib/gestion-clientes/storage";

// ─── Pagos ───────────────────────────────────────────────────────────────────

export async function getPagos(facturaId?: string): Promise<Pago[]> {
  const supabase = await getBrowserSupabaseForEmpresaData();
  let query = supabase
    .from("pagos")
    .select("*")
    .order("fecha_pago", { ascending: false });

  if (facturaId) query = query.eq("factura_id", facturaId);

  const { data, error } = await query;
  if (error) {
    console.error("[facturacion] getPagos:", error.message);
    return [];
  }
  return (data as PagoRow[]).map((r) => ({
    id: r.id,
    factura_id: r.factura_id,
    monto: Number(r.monto),
    fecha_pago: r.fecha_pago,
    metodo_pago: r.metodo_pago as Pago["metodo_pago"],
    referencia: r.referencia ?? undefined,
    created_at: r.created_at,
  }));
}

export type NuevoPagoData = {
  factura_id: string;
  monto: number;
  fecha_pago: string;
  metodo_pago: Pago["metodo_pago"];
  referencia?: string;
};

export async function savePago(datos: NuevoPagoData): Promise<Pago | null> {
  const supabase = await getBrowserSupabaseForEmpresaData();
  const usuario = await getCurrentUser();
  if (!usuario?.empresa_id) throw new Error("Usuario no autenticado o sin empresa");

  const { data: factura } = await supabase
    .from("facturas")
    .select("monto, saldo, estado")
    .eq("id", datos.factura_id)
    .single();

  if (!factura) return null;

  const estado = String(factura.estado ?? "Pendiente");
  if (estado === "Anulado") return null;
  if (estado === "Corregida NC") return null;
  if (estado === "Pagado" && Number(factura.saldo) <= 0) return null;

  const saldoActual = Number(factura.saldo);
  if (datos.monto > saldoActual) return null;

  const nuevoSaldo = Math.max(0, saldoActual - datos.monto);
  const nuevoEstado =
    nuevoSaldo <= 0 ? "Pagado" : estado === "Vencido" ? "Vencido" : "Pendiente";

  const { data, error } = await supabase
    .from("pagos")
    .insert({
      empresa_id: usuario.empresa_id,
      factura_id: datos.factura_id,
      monto: datos.monto,
      fecha_pago: datos.fecha_pago,
      metodo_pago: datos.metodo_pago,
      referencia: datos.referencia ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error("[facturacion] savePago:", error.message);
    return null;
  }

  await supabase
    .from("facturas")
    .update({ saldo: nuevoSaldo, estado: nuevoEstado, updated_at: new Date().toISOString() })
    .eq("id", datos.factura_id);

  return {
    id: (data as PagoRow).id,
    factura_id: (data as PagoRow).factura_id,
    monto: Number((data as PagoRow).monto),
    fecha_pago: (data as PagoRow).fecha_pago,
    metodo_pago: (data as PagoRow).metodo_pago as Pago["metodo_pago"],
    referencia: (data as PagoRow).referencia ?? undefined,
    created_at: (data as PagoRow).created_at,
  };
}
