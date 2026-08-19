import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  confirmarRecepcionOrdenCompra,
  ExcedenteRecepcionError,
  type RecepcionItemInput,
} from "@/lib/ordenes-compra/server/ordenes-compra-pg";

/**
 * POST /api/ordenes-compra/[numero]/recibir
 *
 * Confirma la recepción (parcial o total) de una OC: genera la compra real
 * SOLO con los productos/cantidades marcados como recibidos, impacta stock por
 * esas cantidades, y deja la OC en 'recibida_parcial' o 'recibida_total'.
 * Puede llamarse varias veces sobre la misma OC hasta completar la recepción.
 *
 * Body:
 *  - nro_timbrado, numero_factura (obligatorios — de la compra, no de la OC)
 *  - fecha_factura, observacion (opcionales)
 *  - tipo_pago, plazo_dias
 *  - items: [{ orden_item_id, cantidad_recibida, observacion? }]
 *  - permitir_excedente: boolean — autoriza recibir más que lo pendiente
 *  - comprobante_*
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ numero: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { numero } = await params;
    const empresaId = ctx.auth.empresa_id;
    const schema = await fetchDataSchemaForEmpresaId(empresaId);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const req = (k: string) => body[k] != null && String(body[k]).trim() !== "";
    if (!req("nro_timbrado"))
      return NextResponse.json(errorResponse("Falta el N° de timbrado."), { status: 400 });
    if (!req("numero_factura"))
      return NextResponse.json(errorResponse("Falta el N° de factura."), { status: 400 });

    const str = (k: string) => (req(k) ? String(body[k]).trim() : null);

    const rawItems = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : [];
    if (rawItems.length === 0) {
      return NextResponse.json(errorResponse("No hay productos para recibir."), { status: 400 });
    }
    const items: RecepcionItemInput[] = [];
    for (const it of rawItems) {
      const ordenItemId = it.orden_item_id != null ? String(it.orden_item_id) : "";
      const cantidad = Number(it.cantidad_recibida);
      if (!ordenItemId) continue;
      if (!Number.isFinite(cantidad) || cantidad < 0) {
        return NextResponse.json(errorResponse("Cantidad recibida inválida."), { status: 400 });
      }
      items.push({
        ordenItemId,
        cantidadRecibidaAhora: cantidad,
        observacion: it.observacion != null && String(it.observacion).trim() !== "" ? String(it.observacion).trim().slice(0, 500) : null,
      });
    }

    try {
      const out = await confirmarRecepcionOrdenCompra(schema, empresaId, {
        numeroOc: decodeURIComponent(numero),
        nroTimbrado: String(body.nro_timbrado).trim(),
        numeroFactura: String(body.numero_factura).trim(),
        fechaFactura: str("fecha_factura"),
        tipoPago: body.tipo_pago === "credito" ? "credito" : "contado",
        plazoDias:
          body.plazo_dias != null && String(body.plazo_dias).trim() !== ""
            ? parseInt(String(body.plazo_dias), 10) || null
            : null,
        observacionCompra: req("observacion") ? String(body.observacion).trim().slice(0, 2000) : null,
        comprobante: {
          url: str("comprobante_url"),
          storage_path: str("comprobante_storage_path"),
          nombre: str("comprobante_nombre"),
          mime_type: str("comprobante_mime_type"),
        },
        items,
        permitirExcedente: body.permitir_excedente === true,
        createdBy: ctx.auth.usuarioCatalogId ?? null,
        usuarioNombre: ctx.auth.user?.email ?? null,
      });
      return NextResponse.json(
        successResponse({
          numero_control: out.numero_control,
          estado_oc: out.estado_oc,
          warning: out.movimiento_warning,
        })
      );
    } catch (e) {
      if (e instanceof ExcedenteRecepcionError) {
        return NextResponse.json(
          { ...errorResponse(e.message), excedentes: e.detalle },
          { status: 409 }
        );
      }
      const msg = e instanceof Error ? e.message : "No se pudo recibir la orden.";
      const status =
        /no encontrada/i.test(msg) ? 404 :
        /cancelada|recibida por completo|al menos un producto|inválido|negativa/i.test(msg) ? 409 :
        500;
      console.error("[/api/ordenes-compra/[numero]/recibir]", { empresaId, msg });
      return NextResponse.json(errorResponse(msg), { status });
    }
  } catch (err) {
    console.error("[/api/ordenes-compra/[numero]/recibir] outer", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo recibir la orden de compra."), { status: 500 });
  }
}
