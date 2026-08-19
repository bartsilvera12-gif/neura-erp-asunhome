import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  listOrdenesCompra,
  insertOrdenCompra,
  type OrdenCompraHeaderInput,
  type OrdenCompraItemInput,
} from "@/lib/ordenes-compra/server/ordenes-compra-pg";
import { enviarConfirmacionOrdenCompra } from "@/lib/ordenes-compra/server/orden-compra-email";

/** GET /api/ordenes-compra — lista todas las líneas de OC. */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const ordenes = await listOrdenesCompra(schema, ctx.auth.empresa_id);
    return NextResponse.json(successResponse({ ordenes }));
  } catch (err) {
    console.error("[/api/ordenes-compra GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las órdenes de compra."), { status: 500 });
  }
}

/** POST /api/ordenes-compra — crea una OC (sin impacto en stock, sin factura). */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const schema = await fetchDataSchemaForEmpresaId(empresaId);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const req = (k: string) => body[k] != null && String(body[k]).trim() !== "";
    if (!req("proveedor_id")) return NextResponse.json(errorResponse("Falta el proveedor."), { status: 400 });

    const ivaOk = (v: unknown) =>
      ["exenta", "0", "5", "10"].includes(String(v)) ? (String(v) === "0" ? "exenta" : String(v)) : "10";

    const rawItems = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : [];
    if (rawItems.length === 0)
      return NextResponse.json(errorResponse("La orden de compra no tiene productos."), { status: 400 });

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
      const out = await insertOrdenCompra(schema, empresaId, header, items);

      // Email de confirmación (best-effort: solo si la OC se creó OK; no bloquea
      // ni rompe la respuesta si el SMTP no está configurado o falla).
      try {
        const r = await enviarConfirmacionOrdenCompra(out.ordenes);
        if (!r.ok && !r.skipped) console.error("[ordenes-compra] email:", r.error);
      } catch (mailErr) {
        console.error("[ordenes-compra] email throw:", mailErr instanceof Error ? mailErr.message : mailErr);
      }

      return NextResponse.json(successResponse({ numero_oc: out.numero_oc, ordenes: out.ordenes }));
    } catch (e) {
      const code = (e as { code?: string })?.code;
      console.error("[/api/ordenes-compra POST]", { empresaId, code, msg: e instanceof Error ? e.message : e });
      if (code === "23503")
        return NextResponse.json(errorResponse("Proveedor o producto inválido."), { status: 400 });
      return NextResponse.json(errorResponse("No se pudo crear la orden de compra."), { status: 500 });
    }
  } catch (err) {
    console.error("[/api/ordenes-compra POST] outer", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo crear la orden de compra."), { status: 500 });
  }
}
