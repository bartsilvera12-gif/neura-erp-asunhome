import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  listCompras,
  insertComprasConImpacto,
  type CompraHeaderInput,
  type CompraItemInput,
} from "@/lib/compras/server/compras-pg";

/**
 * GET /api/compras — lista via PG directo.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const rows = await listCompras(schema, ctx.auth.empresa_id);
    return NextResponse.json(successResponse({ compras: rows }));
  } catch (err) {
    console.error("[/api/compras GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las compras."), { status: 500 });
  }
}

/**
 * POST /api/compras — crea compra + movimiento ENTRADA + actualiza producto.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const schema = await fetchDataSchemaForEmpresaId(empresaId);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const req = (k: string) => body[k] != null && String(body[k]).trim() !== "";

    if (!req("proveedor_id")) return NextResponse.json(errorResponse("Falta el proveedor."), { status: 400 });
    if (!req("nro_timbrado"))
      return NextResponse.json(errorResponse("Falta el N° de timbrado."), { status: 400 });
    if (!req("numero_factura"))
      return NextResponse.json(errorResponse("Falta el N° de factura."), { status: 400 });

    const ivaOk = (v: unknown) => (["exenta", "0", "5", "10"].includes(String(v)) ? (String(v) === "0" ? "exenta" : String(v)) : "10");

    // Compat: si no viene items[], envolver el body viejo (compra simple) en una línea.
    const rawItems: Record<string, unknown>[] = Array.isArray(body.items)
      ? (body.items as Record<string, unknown>[])
      : [body];

    if (rawItems.length === 0)
      return NextResponse.json(errorResponse("La compra no tiene productos."), { status: 400 });

    const header: CompraHeaderInput = {
      proveedor_id: String(body.proveedor_id),
      proveedor_nombre: String(body.proveedor_nombre ?? ""),
      moneda: body.moneda === "USD" ? "USD" : "PYG",
      tipo_cambio: Number(body.tipo_cambio) || 1,
      tipo_pago: body.tipo_pago === "credito" ? "credito" : "contado",
      plazo_dias: body.plazo_dias != null && String(body.plazo_dias).trim() !== ""
        ? parseInt(String(body.plazo_dias), 10) || null : null,
      nro_timbrado: String(body.nro_timbrado).trim().toUpperCase(),
      numero_factura: req("numero_factura") ? String(body.numero_factura).trim() : null,
      fecha_factura: req("fecha_factura") ? String(body.fecha_factura).trim().slice(0, 10) : null,
      observacion: req("observacion") ? String(body.observacion).trim().slice(0, 2000) : null,
      orden_compra_numero: req("orden_compra_numero") ? String(body.orden_compra_numero).trim() : null,
      comprobante_url: body.comprobante_url != null && String(body.comprobante_url).trim() !== "" ? String(body.comprobante_url) : null,
      comprobante_storage_path: body.comprobante_storage_path != null && String(body.comprobante_storage_path).trim() !== "" ? String(body.comprobante_storage_path) : null,
      comprobante_nombre: body.comprobante_nombre != null && String(body.comprobante_nombre).trim() !== "" ? String(body.comprobante_nombre) : null,
      comprobante_mime_type: body.comprobante_mime_type != null && String(body.comprobante_mime_type).trim() !== "" ? String(body.comprobante_mime_type) : null,
      created_by: ctx.auth.usuarioCatalogId ?? null,
      usuario_nombre: ctx.auth.user?.email ?? null,
      descuenta_caja: body.descuenta_caja === true,
      fecha: typeof body.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.fecha) ? body.fecha : null,
    };

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
      // El precio de venta NO es obligatorio: para materia prima / insumos no vendibles
      // puede venir vacío o en 0. Solo rechazamos valores negativos.
      if (it.precio_venta != null && Number(it.precio_venta) < 0)
        return NextResponse.json(errorResponse(`${label}: el precio de venta no puede ser negativo.`), { status: 400 });
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
      const out = await insertComprasConImpacto(schema, empresaId, header, items);

      return NextResponse.json(successResponse({
        numero_control: out.numero_control,
        compras: out.compras,
        compra: out.compras[0] ?? null, // compat con clientes single
        warning: out.movimiento_warning,
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      const code = (e as { code?: string })?.code;
      const detail = (e as { detail?: string })?.detail;
      console.error("[/api/compras POST]", { schema, empresaId, msg, code, detail });
      if (code === "23503") {
        return NextResponse.json(
          errorResponse("Proveedor o producto inválido. Verificá los datos seleccionados."),
          { status: 400 }
        );
      }
      if (code === "23505") {
        return NextResponse.json(
          errorResponse("Conflicto al generar el número de control. Reintentá."),
          { status: 409 }
        );
      }
      return NextResponse.json(
        errorResponse("No se pudo guardar la compra. Revisá los datos e intentá nuevamente."),
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("[/api/compras POST] outer", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo guardar la compra."), { status: 500 });
  }
}
