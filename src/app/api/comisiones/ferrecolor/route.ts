import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * GET /api/comisiones/ferrecolor?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 *
 * Calcula comisiones sobre GANANCIA por vendedor. La ganancia se calcula
 * como precio_venta - costo_unitario a nivel item, usando el costo snapshot
 * guardado en movimientos_inventario al momento de la SALIDA.
 *
 * Escalas Ferrecolor:
 *   - Ganancia acumulada < 20.000.000 → 0%
 *   - Ganancia acumulada 20M a 35M     → 5% de la ganancia total
 *   - Ganancia acumulada >= 35M        → 7% de la ganancia total
 *
 * Se aplica el porcentaje del tramo al TOTAL de ganancia (no solo el excedente).
 */

const ESCALAS = [
  { desde: 0,          hasta: 20_000_000, porcentaje: 0 },
  { desde: 20_000_000, hasta: 35_000_000, porcentaje: 5 },
  { desde: 35_000_000, hasta: null,       porcentaje: 7 },
];

function tramoParaGanancia(ganancia: number) {
  for (const e of ESCALAS) {
    if (ganancia >= e.desde && (e.hasta === null || ganancia < e.hasta)) {
      return e;
    }
  }
  return ESCALAS[0];
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;

    const sp = request.nextUrl.searchParams;
    const desde = sp.get("desde") || "";
    const hasta = sp.get("hasta") || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
      return NextResponse.json(errorResponse("Faltan desde/hasta (YYYY-MM-DD)."), { status: 400 });
    }
    const hastaTs = `${hasta}T23:59:59.999Z`;

    // 1) Ventas del periodo (activas)
    const { data: ventasRaw, error: eV } = await ctx.supabase
      .from("ventas")
      .select("id, total, fecha, estado, usuario_nombre, created_by")
      .eq("empresa_id", empresaId)
      .gte("fecha", desde)
      .lte("fecha", hastaTs);
    if (eV) throw new Error(eV.message);

    const ventas = (ventasRaw ?? []).filter(
      (v) => v.estado !== "anulada" && v.estado !== "devuelta_total"
    );
    const ventaIds = ventas.map((v) => String(v.id));
    if (ventaIds.length === 0) {
      return NextResponse.json(successResponse({ por_vendedor: [], periodo: { desde, hasta }, escalas: ESCALAS }));
    }

    // 2) Movimientos SALIDA (costo real snapshot) para esas ventas
    const { data: movs, error: eM } = await ctx.supabase
      .from("movimientos_inventario")
      .select("venta_id, cantidad, costo_unitario, tipo, anulado_at")
      .eq("empresa_id", empresaId)
      .eq("tipo", "SALIDA")
      .in("venta_id", ventaIds);
    if (eM) throw new Error(eM.message);

    const costoPorVenta = new Map<string, number>();
    for (const m of movs ?? []) {
      if (m.anulado_at) continue;
      const vid = String(m.venta_id ?? "");
      if (!vid) continue;
      const c = (Number(m.cantidad) || 0) * (Number(m.costo_unitario) || 0);
      costoPorVenta.set(vid, (costoPorVenta.get(vid) ?? 0) + c);
    }

    // 3) Agrupar por vendedor (usuario_nombre)
    type Agg = { vendedor: string; ventas: number; ingresos: number; costo: number; ganancia: number };
    const porVendedor = new Map<string, Agg>();
    for (const v of ventas) {
      const nombre = (v.usuario_nombre?.trim() as string) || "Sin vendedor";
      const ingresos = Number(v.total) || 0;
      const costo = costoPorVenta.get(String(v.id)) ?? 0;
      const ganancia = ingresos - costo;
      let a = porVendedor.get(nombre);
      if (!a) { a = { vendedor: nombre, ventas: 0, ingresos: 0, costo: 0, ganancia: 0 }; porVendedor.set(nombre, a); }
      a.ventas += 1;
      a.ingresos += ingresos;
      a.costo += costo;
      a.ganancia += ganancia;
    }

    // 4) Aplicar tramo por vendedor
    const filas = [...porVendedor.values()]
      .map((a) => {
        const tramo = tramoParaGanancia(a.ganancia);
        const comision = Math.max(0, Math.round((a.ganancia * tramo.porcentaje) / 100));
        return {
          vendedor: a.vendedor,
          ventas: a.ventas,
          ingresos: Math.round(a.ingresos),
          costo: Math.round(a.costo),
          ganancia: Math.round(a.ganancia),
          tramo_desde: tramo.desde,
          tramo_hasta: tramo.hasta,
          porcentaje: tramo.porcentaje,
          comision,
        };
      })
      .sort((a, b) => b.ganancia - a.ganancia);

    return NextResponse.json(successResponse({
      periodo: { desde, hasta },
      escalas: ESCALAS,
      por_vendedor: filas,
      totales: {
        ventas: filas.reduce((s, f) => s + f.ventas, 0),
        ingresos: filas.reduce((s, f) => s + f.ingresos, 0),
        costo: filas.reduce((s, f) => s + f.costo, 0),
        ganancia: filas.reduce((s, f) => s + f.ganancia, 0),
        comision: filas.reduce((s, f) => s + f.comision, 0),
      },
    }));
  } catch (err) {
    console.error("[/api/comisiones/ferrecolor GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron calcular las comisiones."), { status: 500 });
  }
}
