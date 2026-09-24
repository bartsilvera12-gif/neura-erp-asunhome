/**
 * POST /api/ventas/[id]/cambiar-producto
 * Body: { item_id, nuevo_producto_id, cantidad, precio_venta, tipo_iva }
 *
 * Cambia un producto de la venta por otro, ajustando stock, IVA, total y la caja
 * del día (el arqueo se recalcula solo al cambiar ventas.total). Mantiene el mismo
 * número de factura. Guardrails en cambiarProductoVenta.
 */
import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { cambiarProductoVenta, CambiarProductoError } from "@/lib/ventas/server/cambiar-producto-pg";

export async function POST(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id: ventaId } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json({ success: false, error: "No autenticado" }, { status: 401 });
    const empresaId = ctx.auth.empresa_id;

    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const itemId = String(b.item_id ?? "");
    const nuevoProductoId = String(b.nuevo_producto_id ?? "");
    const cantidad = Number(b.cantidad);
    const precio = Number(b.precio_venta);
    const tipoIvaRaw = String(b.tipo_iva ?? "10%");
    const tipoIva = (tipoIvaRaw === "EXENTA" || tipoIvaRaw === "5%" || tipoIvaRaw === "10%") ? tipoIvaRaw : "10%";
    if (!itemId || !nuevoProductoId) return NextResponse.json({ success: false, error: "Faltan datos (ítem o producto nuevo)." }, { status: 400 });
    if (!Number.isFinite(cantidad) || cantidad <= 0) return NextResponse.json({ success: false, error: "Cantidad inválida." }, { status: 400 });
    if (!Number.isFinite(precio) || precio < 0) return NextResponse.json({ success: false, error: "Precio inválido." }, { status: 400 });

    const schema = await fetchDataSchemaForEmpresaId(empresaId);
    try {
      const r = await cambiarProductoVenta(schema, empresaId, ventaId, {
        itemId,
        nuevoProductoId,
        nuevaCantidad: cantidad,
        nuevoPrecioVenta: precio,
        nuevoTipoIva: tipoIva,
        createdBy: ctx.auth.usuarioCatalogId ?? null,
        usuarioNombre: ctx.auth.nombre ?? ctx.auth.user?.email ?? null,
      });
      return NextResponse.json({ success: true, ...r }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      if (e instanceof CambiarProductoError) {
        return NextResponse.json({ success: false, error: e.message }, { status: 409 });
      }
      throw e;
    }
  } catch (e) {
    console.error("[ventas/cambiar-producto]", e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, error: "No se pudo cambiar el producto." }, { status: 500 });
  }
}
