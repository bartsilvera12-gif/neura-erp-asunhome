import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  getOrdenCompra,
  deleteOrdenCompra,
  updateOrdenCompra,
  type OrdenCompraHeaderInput,
  type OrdenCompraItemInput,
} from "@/lib/ordenes-compra/server/ordenes-compra-pg";

/** GET /api/ordenes-compra/[numero] — líneas de una OC por numero_oc. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ numero: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { numero } = await params;
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const ordenes = await getOrdenCompra(schema, ctx.auth.empresa_id, decodeURIComponent(numero));
    if (ordenes.length === 0)
      return NextResponse.json(errorResponse("Orden de compra no encontrada."), { status: 404 });
    return NextResponse.json(successResponse({ ordenes }));
  } catch (err) {
    console.error("[/api/ordenes-compra/[numero] GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar la orden de compra."), { status: 500 });
  }
}

/** DELETE /api/ordenes-compra/[numero] — borra la OC (solo si esta pendiente). */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ numero: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { numero } = await params;
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const deleted = await deleteOrdenCompra(schema, ctx.auth.empresa_id, decodeURIComponent(numero));
    return NextResponse.json(successResponse({ eliminadas: deleted }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo eliminar la orden de compra.";
    const status = /pendiente|no encontrada/i.test(msg) ? 400 : 500;
    console.error("[/api/ordenes-compra/[numero] DELETE]", msg);
    return NextResponse.json(errorResponse(msg), { status });
  }
}

/** PATCH /api/ordenes-compra/[numero] — edita header + items (solo si esta pendiente). */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ numero: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { numero } = await params;
    const numeroOc = decodeURIComponent(numero);
    const empresaId = ctx.auth.empresa_id;
    const schema = await fetchDataSchemaForEmpresaId(empresaId);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const req = (k: string) => body[k] != null && String(body[k]).trim() !== "";
    if (!req("proveedor_id")) return NextResponse.json(errorResponse("Falta el proveedor."), { status: 400 });

    const ivaOk = (v: unknown) =>
      ["exenta", "0", "5", "10"].includes(String(v)) ? (String(v) === "0" ? "exenta" : String(v)) : "10";

    const rawItems = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : [];
    if (rawItems.length === 0) return NextResponse.json(errorResponse("La orden de compra no tiene productos."), { status: 400 });

    const header: OrdenCompraHeaderInput = {
      proveedor_id: String(body.proveedor_id),
      proveedor_nombre: String(body.proveedor_nombre ?? ""),
      moneda: body.moneda === "USD" ? "USD" : "PYG",
      tipo_cambio: Number(body.tipo_cambio) || 1,
      tipo_pago: body.tipo_pago === "credito" ? "credito" : "contado",
      plazo_dias:
        body.plazo_dias != null && String(body.plazo_dias).trim() !== ""
          ? parseInt(String(body.plazo_dias), 10) || null
          : null,
      observacion: req("observacion") ? String(body.observacion).trim().slice(0, 2000) : null,
      created_by: ctx.auth.usuarioCatalogId ?? null,
      usuario_nombre: ctx.auth.user?.email ?? null,
    };

    const items: OrdenCompraItemInput[] = [];
    for (let i = 0; i < rawItems.length; i++) {
      const it = rawItems[i];
      const label = `Producto ${i + 1}`;
      if (it.producto_id == null || String(it.producto_id).trim() === "")
        return NextResponse.json(errorResponse(`${label}: falta el producto.`), { status: 400 });
      if (!(Number(it.cantidad) > 0))
        return NextResponse.json(errorResponse(`${label}: la cantidad debe ser mayor a 0.`), { status: 400 });
      if (!(Number(it.costo_unitario) > 0))
        return NextResponse.json(errorResponse(`${label}: el costo unitario debe ser mayor a 0.`), { status: 400 });
      items.push({
        producto_id: String(it.producto_id),
        producto_nombre: String(it.producto_nombre ?? ""),
        cantidad: Number(it.cantidad) || 0,
        costo_unitario_original: Number(it.costo_unitario_original) || Number(it.costo_unitario) || 0,
        costo_unitario: Number(it.costo_unitario) || 0,
        iva_tipo: ivaOk(it.iva_tipo),
        subtotal: Number(it.subtotal) || 0,
        monto_iva: Number(it.monto_iva) || 0,
        total: Number(it.total) || 0,
        precio_venta: Number(it.precio_venta) || 0,
        margen_venta: it.margen_venta != null ? Number(it.margen_venta) : null,
      });
    }

    try {
      const out = await updateOrdenCompra(schema, empresaId, numeroOc, header, items);
      return NextResponse.json(successResponse({ numero_oc: out.numero_oc, ordenes: out.ordenes }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No se pudo actualizar la orden de compra.";
      const status = /pendiente|no encontrada/i.test(msg) ? 400 : 500;
      console.error("[/api/ordenes-compra/[numero] PATCH]", msg);
      return NextResponse.json(errorResponse(msg), { status });
    }
  } catch (err) {
    console.error("[/api/ordenes-compra/[numero] PATCH] outer", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo actualizar la orden de compra."), { status: 500 });
  }
}
