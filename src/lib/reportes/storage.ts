import type { EstadoCuentaReporte, ProveedoresReporte, ComprasReporte, VentasReporte, ConciliacionReporte, ComprasPanel, CreditosReporte, ExtractoCliente } from "./types";
import type { CajasReporte, CajaDetalle } from "@/lib/caja/types";
import type { RangoABC } from "@/lib/reportes/abc";
import type { EstadoStock } from "@/lib/reportes/proyeccion";

export interface ProductoRotacion {
  producto_id: string;
  nombre: string;
  sku: string | null;
  stock_actual: number;
  stock_minimo: number;
  cantidad_vendida: number;
  importe_vendido: number;
  rango: RangoABC;
}
export interface RotacionAbc {
  desde: string;
  hasta: string;
  meses: number;
  totales: { total: number; a: number; b: number; c: number; sin_ventas: number };
  page: number;
  pageSize: number;
  total: number;
  productos: ProductoRotacion[];
}
export interface RotacionAbcMapa {
  meses: number;
  mapa: Array<{ producto_id: string; rango: RangoABC }>;
}
export interface RotacionAbcQuery {
  meses: number;
  page?: number;
  pageSize?: number;
  rango?: RangoABC | "";
  q?: string;
}

export interface ProyeccionRowCli {
  producto_id: string;
  nombre: string;
  sku: string | null;
  stock_actual: number;
  stock_minimo: number;
  cantidad_vendida: number;
  promedio_diario: number;
  dias_cobertura: number | null;
  estado: EstadoStock;
}
export interface ProyeccionInventario {
  desde: string;
  hasta: string;
  dias: number;
  totales: Record<EstadoStock, number> & { total: number };
  page: number;
  pageSize: number;
  total: number;
  productos: ProyeccionRowCli[];
}
export interface ProyeccionQuery {
  dias: number;
  page?: number;
  pageSize?: number;
  estado?: EstadoStock | "";
  q?: string;
}

async function getReporte<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { credentials: "include", cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) return null;
    return j.data as T;
  } catch (e) {
    console.error("[reportes] getReporte:", e);
    return null;
  }
}

const mq = (mes: string) => encodeURIComponent(mes);

export const getEstadoCuentaReporte = (mes: string) =>
  getReporte<EstadoCuentaReporte>(`/api/reportes/estado-cuenta?mes=${mq(mes)}`);
export const getProveedoresReporte = (mes: string) =>
  getReporte<ProveedoresReporte>(`/api/reportes/proveedores?mes=${mq(mes)}`);
export const getComprasReporte = (mes: string) =>
  getReporte<ComprasReporte>(`/api/reportes/compras?mes=${mq(mes)}`);
export const getVentasReporte = (mes: string) =>
  getReporte<VentasReporte>(`/api/reportes/ventas?mes=${mq(mes)}`);
export const getConciliacionReporte = (mes: string) =>
  getReporte<ConciliacionReporte>(`/api/reportes/conciliacion?mes=${mq(mes)}`);
export const getCajasReporte = (desde: string, hasta: string) =>
  getReporte<CajasReporte>(`/api/reportes/cajas?desde=${mq(desde)}&hasta=${mq(hasta)}`);
export const getComprasPanel = (desde: string, hasta: string) =>
  getReporte<ComprasPanel>(`/api/reportes/compras-panel?desde=${mq(desde)}&hasta=${mq(hasta)}`);
export const getCreditosReporte = () =>
  getReporte<CreditosReporte>(`/api/reportes/creditos`);
export const getExtractoCliente = (clienteId: string) =>
  getReporte<ExtractoCliente>(`/api/reportes/creditos/${encodeURIComponent(clienteId)}`);
export const getCajaDetalle = (id: string) =>
  getReporte<CajaDetalle>(`/api/reportes/cajas/${encodeURIComponent(id)}`);
export const getRotacionAbcReporte = (opts: RotacionAbcQuery) => {
  const p = new URLSearchParams({ meses: String(opts.meses) });
  if (opts.page) p.set("page", String(opts.page));
  if (opts.pageSize) p.set("pageSize", String(opts.pageSize));
  if (opts.rango) p.set("rango", opts.rango);
  if (opts.q && opts.q.trim()) p.set("q", opts.q.trim());
  return getReporte<RotacionAbc>(`/api/reportes/rotacion-abc?${p.toString()}`);
};
/** Mapa mínimo producto→rango (solo A/B) para el listado de productos. */
export const getRotacionAbcMapa = (meses: number) =>
  getReporte<RotacionAbcMapa>(`/api/reportes/rotacion-abc?meses=${meses}&mapa=1`);
export const getProyeccionInventario = (opts: ProyeccionQuery) => {
  const p = new URLSearchParams({ dias: String(opts.dias) });
  if (opts.page) p.set("page", String(opts.page));
  if (opts.pageSize) p.set("pageSize", String(opts.pageSize));
  if (opts.estado) p.set("estado", opts.estado);
  if (opts.q && opts.q.trim()) p.set("q", opts.q.trim());
  return getReporte<ProyeccionInventario>(`/api/reportes/proyeccion-inventario?${p.toString()}`);
};
export interface ProyeccionProducto extends ProyeccionRowCli { desde: string; hasta: string; dias: number; }
export const getProyeccionProducto = (id: string, dias: number) =>
  getReporte<ProyeccionProducto>(`/api/reportes/proyeccion-inventario/${encodeURIComponent(id)}?dias=${dias}`);
