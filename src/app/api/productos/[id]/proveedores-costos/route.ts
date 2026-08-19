import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * GET /api/productos/[id]/proveedores-costos
 *
 * Fase 1 (solo lectura): historial de costos por proveedor para un producto,
 * derivado de `compras` (estado='registrada'). No crea tablas ni toca datos.
 * Origen = compra real. Incluye indicador de comprobante por compra.
 */

interface CompraRaw {
  id: string;
  numero_control: string;
  proveedor_id: string;
  proveedor_nombre: string;
  fecha: string;
  cantidad: number | string;
  costo_unitario: number | string;
  costo_unitario_original: number | string;
  moneda: string;
  tipo_cambio: number | string;
  total: number | string;
  comprobante_storage_path: string | null;
}

export async function GET(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id: productoId } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;

    const { data, error } = await ctx.supabase
      .from("compras")
      .select(
        "id, numero_control, proveedor_id, proveedor_nombre, fecha, cantidad, costo_unitario, costo_unitario_original, moneda, tipo_cambio, total, comprobante_storage_path"
      )
      .eq("empresa_id", empresaId)
      .eq("producto_id", productoId)
      .eq("estado", "registrada")
      .order("fecha", { ascending: false });

    if (error) {
      console.error("[productos/proveedores-costos]", error.message);
      return NextResponse.json(errorResponse("No se pudo cargar el historial de costos."), { status: 500 });
    }

    const rows = (data ?? []) as unknown as CompraRaw[];

    // Agrupar por proveedor (rows ya vienen ordenadas por fecha desc).
    const map = new Map<string, {
      proveedor_id: string;
      proveedor_nombre: string;
      marca: string | null;
      ultimo_costo: number;
      ultima_fecha: string;
      moneda_ultimo_costo: string;
      costo_unitario_original_ultimo: number;
      tipo_cambio_ultimo: number;
      costo_minimo: number;
      costo_promedio: number; // se completa al final
      _sumaCosto: number;
      cantidad_compras: number;
      historial: Array<{
        compra_id: string;
        numero_control: string;
        fecha: string;
        cantidad: number;
        costo_unitario: number;
        costo_unitario_original: number;
        moneda: string;
        tipo_cambio: number;
        total: number;
        origen: "compra";
        tiene_comprobante: boolean;
      }>;
    }>();

    for (const r of rows) {
      const provKey = r.proveedor_id || r.proveedor_nombre || "sin-proveedor";
      const costo = Number(r.costo_unitario) || 0;
      let g = map.get(provKey);
      if (!g) {
        // primera fila del proveedor = la más reciente (orden desc)
        g = {
          proveedor_id: r.proveedor_id,
          proveedor_nombre: r.proveedor_nombre,
          marca: null,
          ultimo_costo: costo,
          ultima_fecha: r.fecha,
          moneda_ultimo_costo: r.moneda,
          costo_unitario_original_ultimo: Number(r.costo_unitario_original) || costo,
          tipo_cambio_ultimo: Number(r.tipo_cambio) || 1,
          costo_minimo: costo,
          costo_promedio: 0,
          _sumaCosto: 0,
          cantidad_compras: 0,
          historial: [],
        };
        map.set(provKey, g);
      }
      g.costo_minimo = Math.min(g.costo_minimo, costo);
      g._sumaCosto += costo;
      g.cantidad_compras += 1;
      g.historial.push({
        compra_id: r.id,
        numero_control: r.numero_control,
        fecha: r.fecha,
        cantidad: Number(r.cantidad) || 0,
        costo_unitario: costo,
        costo_unitario_original: Number(r.costo_unitario_original) || costo,
        moneda: r.moneda,
        tipo_cambio: Number(r.tipo_cambio) || 1,
        total: Number(r.total) || 0,
        origen: "compra",
        tiene_comprobante: !!r.comprobante_storage_path,
      });
    }

    // Adjuntar marca desde proveedor_productos (dato simple por producto+proveedor).
    try {
      const { data: ppRows } = await ctx.supabase
        .from("proveedor_productos")
        .select("proveedor_id, marca")
        .eq("empresa_id", empresaId)
        .eq("producto_id", productoId);
      const marcaPorProveedor = new Map<string, string | null>();
      for (const pp of (ppRows ?? []) as Array<{ proveedor_id: string; marca: string | null }>) {
        marcaPorProveedor.set(pp.proveedor_id, pp.marca ?? null);
      }
      for (const g of map.values()) {
        if (g.proveedor_id && marcaPorProveedor.has(g.proveedor_id)) {
          g.marca = marcaPorProveedor.get(g.proveedor_id) ?? null;
        }
      }
    } catch (e) {
      // best-effort: si falla, devolvemos los costos sin marca
      console.error("[productos/proveedores-costos] merge marca", e instanceof Error ? e.message : e);
    }

    const proveedores = [...map.values()]
      .map((g) => {
        const { _sumaCosto, ...rest } = g;
        return { ...rest, costo_promedio: g.cantidad_compras > 0 ? _sumaCosto / g.cantidad_compras : 0 };
      })
      .sort((a, b) => new Date(b.ultima_fecha).getTime() - new Date(a.ultima_fecha).getTime());

    return NextResponse.json(successResponse({ proveedores }));
  } catch (err) {
    console.error("[productos/proveedores-costos] outer", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el historial de costos."), { status: 500 });
  }
}
