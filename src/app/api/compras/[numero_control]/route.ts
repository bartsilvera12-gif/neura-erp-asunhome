/**
 * GET  /api/compras/[numero_control] — cabecera + líneas (para editar).
 * PUT  /api/compras/[numero_control] — edición completa: reemplaza productos/costos,
 *      revierte y reaplica stock, y regenera cuotas si corresponde.
 */
import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  editarCompraCompleta,
  getCompraByNumeroControl,
  type CompraHeaderInput,
  type CompraItemInput,
} from "@/lib/compras/server/compras-pg";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ numero_control: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const { numero_control } = await params;
    const numeroControl = decodeURIComponent(numero_control);
    const data = await getCompraByNumeroControl(schema, ctx.auth.empresa_id, numeroControl);
    if (!data) return NextResponse.json(errorResponse("Compra no encontrada."), { status: 404 });
    return NextResponse.json(successResponse(data));
  } catch (err) {
    console.error("[/api/compras/[numero_control] GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar la compra."), { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ numero_control: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const empresaId = ctx.auth.empresa_id;
    const { numero_control } = await params;
    const numeroControl = decodeURIComponent(numero_control);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const req = (k: string) => body[k] != null && String(body[k]).trim() !== "";
    const esProvisoria = body.estado === "provisoria";

    if (!req("proveedor_id")) return NextResponse.json(errorResponse("Falta el proveedor."), { status: 400 });
    if (!esProvisoria && !req("numero_factura"))
      return NextResponse.json(errorResponse("Falta el N° de factura."), { status: 400 });

    const rawItems: Record<string, unknown>[] = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : [];
    if (rawItems.length === 0) return NextResponse.json(errorResponse("La compra no tiene productos."), { status: 400 });

    const header: CompraHeaderInput = {
      proveedor_id: String(body.proveedor_id),
      proveedor_nombre: String(body.proveedor_nombre ?? ""),
      moneda: body.moneda === "USD" ? "USD" : "PYG",
      tipo_cambio: Number(body.tipo_cambio) || 1,
      tipo_pago: body.tipo_pago === "credito" ? "credito" : "contado",
      plazo_dias: body.plazo_dias != null && String(body.plazo_dias).trim() !== "" ? parseInt(String(body.plazo_dias), 10) || null : null,
      nro_timbrado: req("nro_timbrado") ? String(body.nro_timbrado).trim().toUpperCase() : "",
      numero_factura: req("numero_factura") ? String(body.numero_factura).trim() : null,
      fecha_factura: req("fecha_factura") ? String(body.fecha_factura).trim().slice(0, 10) : null,
      observacion: req("observacion") ? String(body.observacion).trim().slice(0, 2000) : null,
      orden_compra_numero: null,
      comprobante_url: null,
      comprobante_storage_path: null,
      comprobante_nombre: null,
      comprobante_mime_type: null,
      created_by: ctx.auth.usuarioCatalogId ?? null,
      usuario_nombre: ctx.auth.user?.email ?? null,
      descuenta_caja: false,
      fecha: typeof body.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.fecha) ? body.fecha : null,
    };

    const ivaOk = (v: unknown) => (["exenta", "0", "5", "10"].includes(String(v)) ? (String(v) === "0" ? "exenta" : String(v)) : "10");
    const items: CompraItemInput[] = [];
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

    const out = await editarCompraCompleta(schema, empresaId, numeroControl, header, items);
    return NextResponse.json(successResponse({ numero_control: out.numero_control, warning: out.movimiento_warning }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo editar la compra.";
    console.error("[/api/compras/[numero_control] PUT]", msg);
    const status = /no encontrada|pagos registrados|al menos un producto|falta|mayor a 0/i.test(msg) ? 400 : 500;
    return NextResponse.json(errorResponse(msg), { status });
  }
}
