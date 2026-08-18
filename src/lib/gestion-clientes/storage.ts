import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { getCurrentUser } from "@/lib/auth";
import { toCalendarDateStr } from "@/lib/fechas/calendario";
import { getBrowserSupabaseForEmpresaData } from "@/lib/supabase/browser-data-client";
import type {
  Factura,
  Tipificacion,
  TipoGestion,
  ResultadoTipificacion,
  EstadoFactura,
} from "./types";

// ─── Tipos de fila Supabase ───────────────────────────────────────────────────

interface FacturaRow {
  id: string;
  empresa_id: string;
  cliente_id: string;
  numero_factura: string;
  fecha: string;
  fecha_vencimiento: string;
  monto: number;
  saldo: number;
  estado: string;
  tipo: string;
  moneda: string;
  fecha_pago_registro?: string | null;
}

interface TipificacionRow {
  id: string;
  empresa_id: string;
  cliente_id: string;
  usuario: string;
  tipo_gestion: string;
  resultado: string;
  observacion: string;
  fecha: string;
}

// ─── Mapeo fila → tipo ────────────────────────────────────────────────────────

function rowToFactura(row: FacturaRow): Factura {
  const fp =
    row.fecha_pago_registro != null && String(row.fecha_pago_registro).trim() !== ""
      ? toCalendarDateStr(String(row.fecha_pago_registro)) || String(row.fecha_pago_registro).slice(0, 10)
      : null;
  return {
    id: row.id,
    cliente_id: row.cliente_id,
    numero_factura: row.numero_factura,
    fecha: row.fecha,
    fecha_vencimiento: row.fecha_vencimiento,
    monto: Number(row.monto),
    saldo: Number(row.saldo),
    estado: row.estado as EstadoFactura,
    tipo: row.tipo as Factura["tipo"],
    moneda: row.moneda as Factura["moneda"],
    fecha_pago_registro: fp,
  };
}

function rowToTipificacion(row: TipificacionRow): Tipificacion {
  return {
    id: row.id,
    cliente_id: row.cliente_id,
    fecha: row.fecha,
    usuario: row.usuario,
    tipo_gestion: row.tipo_gestion as TipoGestion,
    resultado: row.resultado as ResultadoTipificacion,
    observacion: row.observacion,
  };
}

// ─── Facturas ─────────────────────────────────────────────────────────────────

/** Lista facturas vía API tenant (service role). */
export async function getFacturas(clienteId?: string): Promise<Factura[]> {
  if (typeof window === "undefined") return [];
  try {
    const qs = new URLSearchParams();
    if (clienteId) qs.set("cliente_id", clienteId);
    const q = qs.toString();
    const res = await fetchWithSupabaseSession(`/api/facturas${q ? `?${q}` : ""}`, { cache: "no-store" });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.error("[gestion-clientes] getFacturas API:", res.status, t);
      return [];
    }
    const json = (await res.json()) as { success?: boolean; data?: unknown };
    if (!json.success || !Array.isArray(json.data)) return [];
    const rows = (json.data as FacturaRow[]).map(rowToFactura);
    if (process.env.NODE_ENV === "development" && clienteId) {
      console.info("[gestion-clientes] getFacturas", { clienteId, count: rows.length });
    }
    return rows;
  } catch (e) {
    console.error("[gestion-clientes] getFacturas:", e);
    return [];
  }
}

export type NuevaFacturaData = Omit<Factura, "id">;

/** Crea factura. empresa_id desde getCurrentUser(). */
export async function saveFactura(
  datos: NuevaFacturaData
): Promise<Factura | null> {
  const supabase = await getBrowserSupabaseForEmpresaData();
  const usuario = await getCurrentUser();
  if (!usuario?.empresa_id) throw new Error("Usuario no autenticado o sin empresa");

  const insert = {
    empresa_id: usuario.empresa_id,
    cliente_id: datos.cliente_id,
    numero_factura: datos.numero_factura,
    fecha: datos.fecha,
    fecha_vencimiento: datos.fecha_vencimiento,
    monto: datos.monto,
    saldo: datos.saldo,
    estado: datos.estado,
    tipo: datos.tipo,
    moneda: datos.moneda,
  };

  const { data, error } = await supabase
    .from("facturas")
    .insert([insert])
    .select()
    .single();

  if (error) {
    console.error("[gestion-clientes] saveFactura:", error.message);
    return null;
  }
  return rowToFactura(data as FacturaRow);
}

// ─── Tipificaciones ────────────────────────────────────────────────────────────

/** Lista tipificaciones de un cliente. RLS filtra por empresa. */
export async function getTipificaciones(clienteId: string): Promise<Tipificacion[]> {
  const supabase = await getBrowserSupabaseForEmpresaData();
  const { data, error } = await supabase
    .from("tipificaciones")
    .select("*")
    .eq("cliente_id", clienteId)
    .order("fecha", { ascending: false });

  if (error) {
    console.error("[gestion-clientes] getTipificaciones:", error.message);
    return [];
  }
  return (data as TipificacionRow[]).map(rowToTipificacion);
}

export interface NuevaTipificacion {
  cliente_id: string;
  usuario: string;
  tipo_gestion: TipoGestion;
  resultado: ResultadoTipificacion;
  observacion: string;
}

/** Crea tipificación. empresa_id desde getCurrentUser(). */
export async function saveTipificacion(
  datos: NuevaTipificacion
): Promise<Tipificacion | null> {
  const supabase = await getBrowserSupabaseForEmpresaData();
  const usuario = await getCurrentUser();
  if (!usuario?.empresa_id) throw new Error("Usuario no autenticado o sin empresa");

  const insert = {
    empresa_id: usuario.empresa_id,
    cliente_id: datos.cliente_id,
    usuario: datos.usuario,
    tipo_gestion: datos.tipo_gestion,
    resultado: datos.resultado,
    observacion: datos.observacion.trim(),
  };

  const { data, error } = await supabase
    .from("tipificaciones")
    .insert([insert])
    .select()
    .single();

  if (error) {
    console.error("[gestion-clientes] saveTipificacion:", error.message);
    return null;
  }
  return rowToTipificacion(data as TipificacionRow);
}
