/**
 * GET /api/clientes/[id]/compras — historial de compras (ventas) de un cliente.
 *
 * Devuelve las ventas asociadas al cliente con: fecha, total, estado, Nº de venta
 * (numero_control), Nº de factura ERP (si existe, vía puente ventas→facturas) y el
 * detalle de productos (nombre + cantidad). Es de solo lectura: NO toca stock, caja,
 * IVA ni totales; reutiliza las relaciones existentes.
 */
import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

interface VentaRow {
  id: string;
  numero_control: string;
  fecha: string;
  total: number | string;
  tipo_venta: string;
  estado?: string | null;
  factura_id?: string | null;
}

interface ItemRow {
  venta_id: string;
  producto_nombre: string;
  cantidad: number | string;
}

function num(v: number | string | null | undefined): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id: clienteId } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;

    const ventasQ = await ctx.supabase
      .from("ventas")
      .select("id, numero_control, fecha, total, tipo_venta, estado, factura_id")
      .eq("empresa_id", empresaId)
      .eq("cliente_id", clienteId)
      .order("fecha", { ascending: false })
      .limit(300);
    if (ventasQ.error) throw new Error(ventasQ.error.message);
    const ventasRows = (ventasQ.data ?? []) as VentaRow[];

    if (ventasRows.length === 0) {
      return NextResponse.json(successResponse({ compras: [] }));
    }

    const ventaIds = ventasRows.map((v) => v.id);

    // Ítems (nombre + cantidad) de esas ventas, para el detalle de productos.
    const itemsQ = await ctx.supabase
      .from("ventas_items")
      .select("venta_id, producto_nombre, cantidad")
      .eq("empresa_id", empresaId)
      .in("venta_id", ventaIds);
    const itemsRows = itemsQ.error ? [] : ((itemsQ.data ?? []) as ItemRow[]);
    const itemsByVenta = new Map<string, Array<{ nombre: string; cantidad: number }>>();
    for (const it of itemsRows) {
      const list = itemsByVenta.get(it.venta_id) ?? [];
      list.push({ nombre: String(it.producto_nombre ?? ""), cantidad: num(it.cantidad) });
      itemsByVenta.set(it.venta_id, list);
    }

    // Nº de factura REAL por venta, resuelto por DOS vías (best-effort, SOLO
    // lectura: no genera ni reserva ninguna factura):
    //  (1) forward: ventas.factura_id → facturas.id
    //  (2) reverse: facturas.origen_venta_id → ventas.id  — más confiable, porque
    //      se setea atómicamente al emitir la factura, mientras que ventas.factura_id
    //      es un UPDATE posterior que puede faltar en ventas históricas (por eso
    //      algunas compras mostraban solo el VTA- interno).
    // Se prefiere cualquier numero_factura no nulo.
    const numeroFacturaByVentaId = new Map<string, string>();

    // (1) forward
    const facturaIds = [
      ...new Set(ventasRows.map((v) => v.factura_id).filter((x): x is string => !!x)),
    ];
    if (facturaIds.length > 0) {
      const facQ = await ctx.supabase
        .from("facturas")
        .select("id, numero_factura")
        .eq("empresa_id", empresaId)
        .in("id", facturaIds);
      if (!facQ.error) {
        const numById = new Map<string, string>();
        for (const row of (facQ.data ?? []) as Array<{ id: string; numero_factura?: string | null }>) {
          if (row.numero_factura) numById.set(row.id, row.numero_factura);
        }
        for (const v of ventasRows) {
          if (v.factura_id) {
            const n = numById.get(v.factura_id);
            if (n) numeroFacturaByVentaId.set(v.id, n);
          }
        }
      }
    }

    // (2) reverse — cubre ventas cuyo factura_id no quedó backfilleado. La columna
    // origen_venta_id es aditiva del puente venta→factura; si el schema del tenant
    // no la tiene, PostgREST devuelve error y simplemente se ignora esta vía.
    try {
      const revQ = await ctx.supabase
        .from("facturas")
        .select("numero_factura, origen_venta_id")
        .eq("empresa_id", empresaId)
        .in("origen_venta_id", ventaIds);
      if (!revQ.error) {
        for (const row of (revQ.data ?? []) as Array<{ numero_factura?: string | null; origen_venta_id?: string | null }>) {
          const vid = row.origen_venta_id;
          if (vid && row.numero_factura && !numeroFacturaByVentaId.has(vid)) {
            numeroFacturaByVentaId.set(vid, row.numero_factura);
          }
        }
      }
    } catch {
      /* columna origen_venta_id ausente en el schema del tenant: se ignora */
    }

    const compras = ventasRows.map((v) => {
      const estado = ((): "activa" | "anulada" | "parcialmente_devuelta" | "devuelta_total" => {
        if (v.estado === "anulada") return "anulada";
        if (v.estado === "devuelta_total") return "devuelta_total";
        if (v.estado === "parcialmente_devuelta") return "parcialmente_devuelta";
        return "activa";
      })();
      return {
        id: v.id,
        numero_control: v.numero_control,
        fecha: v.fecha,
        total: num(v.total),
        tipo_venta: v.tipo_venta === "CREDITO" ? "CREDITO" : "CONTADO",
        estado,
        numero_factura: numeroFacturaByVentaId.get(v.id) ?? null,
        productos: itemsByVenta.get(v.id) ?? [],
      };
    });

    return NextResponse.json(successResponse({ compras }));
  } catch (err) {
    console.error("[/api/clientes/[id]/compras GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el historial de compras."), { status: 500 });
  }
}
