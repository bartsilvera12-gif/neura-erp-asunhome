import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { getProspectos } from "@/lib/crm/storage";
import { toCalendarDateStr } from "@/lib/fechas/calendario";

// ── Tipos de salida (estructura esperada por el Dashboard en page.tsx) ────────

export interface ProspectoRaw {
  id: number | string;
  empresa: string;
  contacto?: string;
  etapa: string;
  servicio?: string;
  valor_estimado?: number;
  fecha_creacion: string;
  fecha_actualizacion: string;
  responsable?: string;
  cliente_creado?: boolean;
}

export interface ClienteRaw {
  id: number | string;
  codigo_cliente: string;
  empresa?: string;
  nombre_contacto: string;
  origen: string;
  created_at: string;
  vendedor_asignado?: string;
  /** Para distribución en dashboard (prioridad: tipo servicio → condición → origen) */
  tipo_servicio_cliente?: string;
  condicion_pago?: string;
}

export interface FacturaRaw {
  id: number | string;
  cliente_id: number | string;
  numero_factura: string;
  fecha: string;
  fecha_vencimiento: string;
  monto: number;
  saldo: number;
  estado: string;
  tipo: string;
  moneda: string;
}

export interface TipificacionRaw {
  id: number | string;
  cliente_id: number | string;
  tipo_gestion: string;
  resultado: string;
  observacion?: string;
  usuario: string;
  fecha: string;
}

export interface ProductoRaw {
  id: number | string;
  nombre: string;
  sku: string;
  costo_promedio: number;
  precio_venta: number;
  stock_actual: number;
  stock_minimo: number;
  unidad_medida: string;
  metodo_valuacion: string;
}

export interface LineaVentaRaw {
  producto_id: number | string;
  producto_nombre: string;
  sku?: string;
  cantidad: number;
  precio_venta: number;
  subtotal: number;
  monto_iva?: number;
  total: number;
}

export interface VentaRaw {
  id: number | string;
  numero_control: string;
  lineas: LineaVentaRaw[];
  subtotal: number;
  monto_iva: number;
  total: number;
  tipo_venta: string;
  moneda: string;
  tipo_cambio?: number;
  fecha: string;
}

export interface CompraRaw {
  id: number | string;
  producto_id?: number | string;
  producto_nombre: string;
  proveedor_nombre: string;
  total: number;
  fecha: string;
}

export interface GastoRaw {
  id: string;
  monto: number;
  fecha: string;
}

export interface PagoRaw {
  id: string;
  factura_id: string;
  monto: number;
  fecha_pago: string;
}

/** Suscripciones para métricas comerciales (valor cliente nuevo en período). */
export interface SuscripcionDashRow {
  id: string;
  cliente_id: string;
  precio: number;
  moneda: string;
  fecha_inicio: string;
  created_at: string;
}

/** True si la factura está anulada (cualquier capitalización). */
export function esFacturaAnulada(estado: string | null | undefined): boolean {
  return String(estado ?? "").trim().toLowerCase() === "anulado";
}

/** Liquidada por nota de crédito SET (sin saldo cobrable vía módulo Pagos). */
export function esFacturaCorregidaNc(estado: string | null | undefined): boolean {
  return String(estado ?? "").trim().toLowerCase() === "corregida nc";
}

/** Notas de crédito aprobadas (SET) para netear facturas en métricas comerciales. */
export interface NotaCreditoDashRow {
  id: string;
  factura_id: string;
  monto: number;
  estado_erp: string;
}

/** Suma de montos NC con `estado_erp = aprobada` por `factura_id`. */
export function buildMontoNcAprobadaPorFacturaId(rows: NotaCreditoDashRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (String(r.estado_erp ?? "").trim().toLowerCase() !== "aprobada") continue;
    const fid = String(r.factura_id);
    m.set(fid, (m.get(fid) ?? 0) + (Number(r.monto) || 0));
  }
  return m;
}

/**
 * Monto que cuenta para valor comercial: excluye anuladas / corregidas por NC,
 * y resta NC aprobadas vinculadas (factura cancelada por NC + nueva emisión).
 */
export function montoFacturaNetoValorComercial(
  f: FacturaRaw,
  ncPorFactura: Map<string, number>
): number {
  if (esFacturaAnulada(f.estado)) return 0;
  if (esFacturaCorregidaNc(f.estado)) return 0;
  const monto = Number(f.monto) || 0;
  const ncTotal = ncPorFactura.get(String(f.id)) ?? 0;
  const net = monto - ncTotal;
  return net > 0.01 ? net : 0;
}

export interface DashboardData {
  prospectos: ProspectoRaw[];
  clientes: ClienteRaw[];
  facturas: FacturaRaw[];
  pagos: PagoRaw[];
  tipificaciones: TipificacionRaw[];
  productos: ProductoRaw[];
  ventas: VentaRaw[];
  compras: CompraRaw[];
  gastos: GastoRaw[];
  suscripciones: SuscripcionDashRow[];
  /** Clientes dados de baja operativa en el mes actual */
  clientes_baja_mes: number;
  /** Monto mensual perdido por bajas del mes (suma de precios de suscripciones canceladas) */
  monto_perdido_bajas_mes: number;
  /** NC aprobadas por factura (para netear valor en cartera comercial). */
  notas_credito: NotaCreditoDashRow[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Timestamps (created_at, etc.): mantener ISO de Supabase sin recomputar UTC desde date-only. */
function toIsoTimestampStr(v: string | null | undefined): string {
  if (!v) return "";
  const s = String(v).trim();
  if (s.includes("T")) return s;
  const d = new Date(s);
  return isNaN(d.getTime()) ? "" : d.toISOString();
}

/**
 * Convierte cualquier valor a número seguro.
 * Formato Paraguay: "450.000" = 450 mil, "450.000.000" = 450 millones.
 * Evita que "450.000" se parsee como 450 (parseFloat corta en el primer punto).
 */
function toNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const s = v.replace(/\s/g, "").trim();
    if (!s) return 0;
    // Si tiene coma: decimal europeo (1.234,56)
    if (s.includes(",")) {
      const [intPart, decPart] = s.split(",");
      const n = parseFloat((intPart || "").replace(/\./g, "") + "." + (decPart || "0"));
      return Number.isFinite(n) ? n : 0;
    }
    // Si tiene punto: puede ser miles (450.000) o decimal (450.50)
    const parts = s.split(".");
    if (parts.length === 1) return parseFloat(parts[0]) || 0;
    const last = parts[parts.length - 1] || "";
    // Última parte 1-2 dígitos = decimales (450.50)
    if (last.length <= 2 && /^\d+$/.test(last)) {
      const n = parseFloat(parts.slice(0, -1).join("") + "." + last);
      return Number.isFinite(n) ? n : 0;
    }
    // Última parte 3+ dígitos = separador de miles (450.000)
    const n = parseFloat(parts.join(""));
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ── getDashboardData ──────────────────────────────────────────────────────────

/**
 * Prospectos vía `/api/crm/prospectos` (tenant + service role), alineado al CRM Funnel.
 */
async function fetchProspectos(): Promise<ProspectoRaw[]> {
  const prospectosFromCrm = await getProspectos();
  return prospectosFromCrm.map((p) => ({
    id: p.id,
    empresa: p.empresa,
    contacto: p.contacto,
    etapa: p.etapa,
    servicio: p.servicio,
    valor_estimado: p.valor_estimado ?? 0,
    fecha_creacion: p.fecha_creacion ?? "",
    fecha_actualizacion: p.fecha_actualizacion ?? "",
    responsable: p.responsable,
    cliente_creado: p.cliente_creado,
  }));
}

/**
 * Dashboard: tablas operativas vía `/api/dashboard/tenant-tables` (service role + schema tenant).
 * No depende del cliente browser + RLS en esquemas `erp_*`.
 */
export async function getDashboardData(): Promise<DashboardData> {
  const prospectos = await fetchProspectos();

  let clientes: ClienteRaw[] = [];
  let facturas: FacturaRaw[] = [];
  let pagos: PagoRaw[] = [];
  let tipificaciones: TipificacionRaw[] = [];
  let productos: ProductoRaw[] = [];
  let ventas: VentaRaw[] = [];
  let compras: CompraRaw[] = [];
  let gastos: GastoRaw[] = [];
  let suscripciones: SuscripcionDashRow[] = [];
  let clientesBajaMes = 0;
  let montoPerdidoBajasMes = 0;
  let notasCredito: NotaCreditoDashRow[] = [];

  if (typeof window === "undefined") {
    return {
      prospectos,
      clientes,
      facturas,
      pagos,
      tipificaciones,
      productos,
      ventas,
      compras,
      gastos,
      suscripciones,
      clientes_baja_mes: clientesBajaMes,
      monto_perdido_bajas_mes: montoPerdidoBajasMes,
      notas_credito: notasCredito,
    };
  }

  /**
   * Rango temporal por defecto: últimos 13 meses.
   * El Dashboard tiene un filtro de período en el header (Hoy / 7d / 30d / Mes actual / Año)
   * que se aplica del lado del cliente. 13 meses cubre cualquier elección del usuario y
   * evita traer histórico completo de la empresa (que en ERPs de varios años puede ser
   * decenas de miles de filas en `ventas` / `ventas_items`).
   *
   * Si querés ver TODO el histórico explícitamente, pasá `?desde=&hasta=` vacíos en URL
   * o llamá al endpoint sin el query string.
   */
  const dashboardNow = new Date();
  const dashboardDesde = new Date(
    dashboardNow.getFullYear(),
    dashboardNow.getMonth() - 13,
    dashboardNow.getDate()
  );
  const fmtYmd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const dashboardRangeQs = `?desde=${fmtYmd(dashboardDesde)}&hasta=${fmtYmd(dashboardNow)}`;

  try {
    const res = await fetchWithSupabaseSession(
      `/api/dashboard/tenant-tables${dashboardRangeQs}`,
      { cache: "no-store" }
    );
    if (!res.ok) throw new Error(await res.text());
    const json = (await res.json()) as {
      success?: boolean;
      data?: {
        clientes?: Record<string, unknown>[];
        facturas?: Record<string, unknown>[];
        pagos?: Record<string, unknown>[];
        tipificaciones?: Record<string, unknown>[];
        productos?: Record<string, unknown>[];
        ventas?: Record<string, unknown>[];
        ventas_items?: Record<string, unknown>[];
        compras?: Record<string, unknown>[];
        gastos?: Record<string, unknown>[];
        suscripciones?: Record<string, unknown>[];
        clientes_baja_mes?: { id: string }[];
        suscripciones_canceladas?: { cliente_id: string; precio: number }[];
        notas_credito?: Record<string, unknown>[];
      };
    };
    if (!json.success || !json.data) throw new Error("Respuesta inválida");
    const d = json.data as {
      query_errors?: Partial<Record<string, string>>;
      clientes?: Record<string, unknown>[];
      facturas?: Record<string, unknown>[];
      pagos?: Record<string, unknown>[];
      tipificaciones?: Record<string, unknown>[];
      productos?: Record<string, unknown>[];
      ventas?: Record<string, unknown>[];
      ventas_items?: Record<string, unknown>[];
      compras?: Record<string, unknown>[];
      gastos?: Record<string, unknown>[];
      suscripciones?: Record<string, unknown>[];
      clientes_baja_mes?: { id: string }[];
      suscripciones_canceladas?: { cliente_id: string; precio: number }[];
      notas_credito?: Record<string, unknown>[];
    };

    if (d.query_errors && Object.keys(d.query_errors).length > 0) {
      console.warn("[getDashboardData] Algunas tablas fallaron en PostgREST (el resto se cargó):", d.query_errors);
    }

    const clientesBajaIds = new Set((d.clientes_baja_mes ?? []).map((c) => c.id));
    const suscBajas = d.suscripciones_canceladas ?? [];
    clientesBajaMes = clientesBajaIds.size;
    montoPerdidoBajasMes = suscBajas
      .filter((s) => clientesBajaIds.has(s.cliente_id))
      .reduce((sum, s) => sum + Number(s.precio ?? 0), 0);

    clientes = (d.clientes ?? [])
      .filter((r) => !(r as Record<string, unknown>).deleted_at)
      .map((r: Record<string, unknown>) => ({
        id: r.id as string,
        codigo_cliente: `CL-${(r.id as string).slice(0, 8).toUpperCase()}`,
        empresa: r.empresa as string | undefined,
        nombre_contacto: (r.nombre_contacto as string) ?? (r.nombre as string) ?? "",
        origen: (r.origen as string) ?? "MANUAL",
        created_at: toIsoTimestampStr(r.created_at as string),
        vendedor_asignado: r.vendedor_asignado as string | undefined,
        tipo_servicio_cliente: (r.tipo_servicio_cliente as string) ?? undefined,
        condicion_pago: (r.condicion_pago as string) ?? undefined,
      }));

    facturas = (d.facturas ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      cliente_id: r.cliente_id as string,
      numero_factura: (r.numero_factura as string) ?? "",
      fecha: toCalendarDateStr(r.fecha as string),
      fecha_vencimiento: toCalendarDateStr(r.fecha_vencimiento as string),
      monto: toNum(r.monto),
      saldo: toNum(r.saldo),
      estado: (r.estado as string) ?? "Pendiente",
      tipo: (r.tipo as string) ?? "credito",
      moneda: (r.moneda as string) ?? "GS",
    }));

    pagos = (d.pagos ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      factura_id: r.factura_id as string,
      monto: toNum(r.monto),
      fecha_pago: toCalendarDateStr(r.fecha_pago as string),
    }));

    tipificaciones = (d.tipificaciones ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      cliente_id: r.cliente_id as string,
      tipo_gestion: (r.tipo_gestion as string) ?? "",
      resultado: (r.resultado as string) ?? "",
      observacion: r.observacion as string | undefined,
      usuario: (r.usuario as string) ?? "",
      fecha: toCalendarDateStr(r.fecha as string),
    }));

    productos = (d.productos ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      nombre: (r.nombre as string) ?? "",
      sku: (r.sku as string) ?? "",
      costo_promedio: Number(r.costo_promedio) ?? 0,
      precio_venta: Number(r.precio_venta) ?? 0,
      stock_actual: Number(r.stock_actual) ?? 0,
      stock_minimo: Number(r.stock_minimo) ?? 0,
      unidad_medida: (r.unidad_medida as string) ?? "Unidad",
      metodo_valuacion: (r.metodo_valuacion as string) ?? "CPP",
    }));

    const itemsByVenta = new Map<string, LineaVentaRaw[]>();
    for (const it of d.ventas_items ?? []) {
      const r = it as Record<string, unknown>;
      const ventaId = r.venta_id as string;
      const lineas = itemsByVenta.get(ventaId) ?? [];
      lineas.push({
        producto_id: r.producto_id as string,
        producto_nombre: (r.producto_nombre as string) ?? "",
        sku: r.sku as string | undefined,
        cantidad: Number(r.cantidad) ?? 0,
        precio_venta: Number(r.precio_venta) ?? 0,
        subtotal: Number(r.subtotal) ?? 0,
        monto_iva: Number(r.monto_iva) ?? 0,
        total: Number(r.total_linea) ?? 0,
      });
      itemsByVenta.set(ventaId, lineas);
    }

    ventas = (d.ventas ?? []).map((r: Record<string, unknown>) => {
      const id = r.id as string;
      return {
        id,
        numero_control: (r.numero_control as string) ?? "",
        lineas: itemsByVenta.get(id) ?? [],
        subtotal: Number(r.subtotal) ?? 0,
        monto_iva: Number(r.monto_iva) ?? 0,
        total: Number(r.total) ?? 0,
        tipo_venta: (r.tipo_venta as string) ?? "CONTADO",
        moneda: (r.moneda as string) ?? "GS",
        tipo_cambio: Number(r.tipo_cambio) ?? 1,
        fecha: toCalendarDateStr(r.fecha as string) || toIsoTimestampStr(r.fecha as string),
      };
    });

    compras = (d.compras ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      producto_id: r.producto_id as string | undefined,
      producto_nombre: (r.producto_nombre as string) ?? "",
      proveedor_nombre: (r.proveedor_nombre as string) ?? "",
      total: toNum(r.total),
      fecha: toCalendarDateStr(r.fecha as string),
    }));

    gastos = (d.gastos ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      monto: toNum(r.monto),
      fecha: (r.fecha as string) ?? "",
    }));

    suscripciones = (d.suscripciones ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      cliente_id: r.cliente_id as string,
      precio: toNum(r.precio),
      moneda: (r.moneda as string) ?? "GS",
      fecha_inicio: toCalendarDateStr(r.fecha_inicio as string),
      created_at: toIsoTimestampStr(r.created_at as string),
    }));

    notasCredito = (d.notas_credito ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      factura_id: String(r.factura_id ?? ""),
      monto: toNum(r.monto),
      estado_erp: String(r.estado_erp ?? ""),
    }));
  } catch (err) {
    console.warn("[dashboard] Error cargando tablas empresa (clientes, facturas, etc.):", err);
    // prospectos ya cargados; clientes, facturas, etc. quedan vacíos
  }

  return {
    prospectos,
    clientes,
    facturas,
    pagos,
    tipificaciones,
    productos,
    ventas,
    compras,
    gastos,
    suscripciones,
    clientes_baja_mes: clientesBajaMes,
    monto_perdido_bajas_mes: montoPerdidoBajasMes,
    notas_credito: notasCredito,
  };
}
