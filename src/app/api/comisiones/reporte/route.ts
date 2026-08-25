/**
 * GET /api/comisiones/reporte?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 *
 * Reporte de comisiones (modelo ASUNHOME): comisión = % fijo del TOTAL de ventas
 * de cada vendedor en el período. El % sale de usuarios.porcentaje_comision.
 *
 * Base = ventas.total (activas: excluye anuladas y devueltas totales) agrupadas
 * por ventas.vendedor_id. Solo se listan usuarios con es_vendedor=true.
 */
import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse("No autenticado"), { status: 401 });
    const empresaId = ctx.auth.empresa_id;

    const sp = request.nextUrl.searchParams;
    const desde = sp.get("desde") || "";
    const hasta = sp.get("hasta") || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
      return NextResponse.json(errorResponse("Faltan desde/hasta (YYYY-MM-DD)."), { status: 400 });
    }
    const hastaTs = `${hasta}T23:59:59.999Z`;

    // Vendedores (define quiénes aparecen y con qué %).
    const { data: vendRaw, error: eVen } = await ctx.supabase
      .from("usuarios")
      .select("id, nombre, email, porcentaje_comision")
      .eq("empresa_id", empresaId)
      .eq("es_vendedor", true)
      .order("nombre", { ascending: true });
    if (eVen) throw new Error(eVen.message);

    type Fila = {
      vendedor_id: string;
      vendedor: string;
      porcentaje: number;
      cantidad_ventas: number;
      total_vendido: number;
      comision: number;
    };
    const porVendedor = new Map<string, Fila>();
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

    // Ventas activas del período con vendedor asignado.
    const { data: ventasRaw, error: eV } = await ctx.supabase
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
      if (!fila) continue; // venta con vendedor que ya no es vendedor: se ignora
      fila.cantidad_ventas += 1;
      fila.total_vendido += Number((v as { total?: number | string }).total) || 0;
    }

    const filas = [...porVendedor.values()].map((f) => ({
      ...f,
      total_vendido: Math.round(f.total_vendido),
      comision: Math.round((f.total_vendido * f.porcentaje) / 100),
    }));

    return NextResponse.json(
      successResponse({
        periodo: { desde, hasta },
        por_vendedor: filas,
        totales: {
          cantidad_ventas: filas.reduce((s, f) => s + f.cantidad_ventas, 0),
          total_vendido: filas.reduce((s, f) => s + f.total_vendido, 0),
          comision: filas.reduce((s, f) => s + f.comision, 0),
        },
      })
    );
  } catch (err) {
    console.error("[/api/comisiones/reporte GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron calcular las comisiones."), { status: 500 });
  }
}
