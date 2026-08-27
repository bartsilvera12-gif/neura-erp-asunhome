/**
 * Reporte de comisiones (modelo ASUNHOME): comisión = % del TOTAL de ventas por
 * vendedor en el período. Compartido por la ruta JSON y el export Excel.
 */
import type { AppSupabaseClient } from "@/lib/supabase/schema";

export interface FilaComision {
  vendedor_id: string;
  vendedor: string;
  porcentaje: number;
  cantidad_ventas: number;
  total_vendido: number;
  comision: number;
}
export interface ReporteComisiones {
  periodo: { desde: string; hasta: string };
  por_vendedor: FilaComision[];
  totales: { cantidad_ventas: number; total_vendido: number; comision: number };
}

export async function computeReporteComisiones(
  supabase: AppSupabaseClient,
  empresaId: string,
  desde: string,
  hasta: string
): Promise<ReporteComisiones> {
  const hastaTs = `${hasta}T23:59:59.999Z`;

  const { data: vendRaw, error: eVen } = await supabase
    .from("usuarios")
    .select("id, nombre, email, porcentaje_comision")
    .eq("empresa_id", empresaId)
    .eq("es_vendedor", true)
    .order("nombre", { ascending: true });
  if (eVen) throw new Error(eVen.message);

  const porVendedor = new Map<string, FilaComision>();
  for (const v of vendRaw ?? []) {
    const id = String((v as { id: string }).id);
    const nombre = ((v as { nombre?: string | null }).nombre ?? "").trim() || ((v as { email?: string | null }).email ?? "");
    porVendedor.set(id, {
      vendedor_id: id,
      vendedor: nombre,
      porcentaje: Number((v as { porcentaje_comision?: number | null }).porcentaje_comision) || 0,
      cantidad_ventas: 0,
      total_vendido: 0,
      comision: 0,
    });
  }

  const { data: ventasRaw, error: eV } = await supabase
    .from("ventas")
    .select("id, total, estado, vendedor_id")
    .eq("empresa_id", empresaId)
    .gte("fecha", desde)
    .lte("fecha", hastaTs);
  if (eV) throw new Error(eV.message);

  for (const v of ventasRaw ?? []) {
    const estado = (v as { estado?: string | null }).estado ?? "";
    if (estado === "anulada" || estado === "devuelta_total") continue;
    const vid = (v as { vendedor_id?: string | null }).vendedor_id;
    if (!vid) continue;
    const fila = porVendedor.get(String(vid));
    if (!fila) continue;
    fila.cantidad_ventas += 1;
    fila.total_vendido += Number((v as { total?: number | string }).total) || 0;
  }

  const por_vendedor = [...porVendedor.values()].map((f) => ({
    ...f,
    total_vendido: Math.round(f.total_vendido),
    comision: Math.round((f.total_vendido * f.porcentaje) / 100),
  }));

  return {
    periodo: { desde, hasta },
    por_vendedor,
    totales: {
      cantidad_ventas: por_vendedor.reduce((s, f) => s + f.cantidad_ventas, 0),
      total_vendido: por_vendedor.reduce((s, f) => s + f.total_vendido, 0),
      comision: por_vendedor.reduce((s, f) => s + f.comision, 0),
    },
  };
}
