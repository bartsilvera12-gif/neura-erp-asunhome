import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { mapPedidoCaja, PEDIDO_CAJA_COLS } from "@/lib/pedidos-caja/server";

/**
 * GET /api/pedidos-caja/[id]
 *   Devuelve un pedido por id. Se usa al precargar /ventas/nueva?pedido_caja_id=X.
 *
 * PATCH /api/pedidos-caja/[id]
 *   Edita un pedido. Solo permitido si estado in (pendiente, en_caja).
 *   Body: { cliente_id?, cliente_nombre?, cliente_telefono?, observacion?, items?: [...] }
 *
 * DELETE /api/pedidos-caja/[id]?motivo=...
 *   Marca como cancelado. Permitido si estado in (pendiente, en_caja).
 */
export async function GET(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const q = await ctx.supabase
      .from("pedidos_caja")
      .select(PEDIDO_CAJA_COLS)
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id)
      .maybeSingle();
    if (q.error) return NextResponse.json(errorResponse(q.error.message), { status: 400 });
    if (!q.data) return NextResponse.json(errorResponse("Pedido no encontrado."), { status: 404 });

    return NextResponse.json(
      successResponse({ pedido: mapPedidoCaja((q.data as unknown) as Record<string, unknown>) })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo cargar el pedido.";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

interface BodyItem {
  producto_id: string;
  producto_nombre: string;
  sku?: string | null;
  cantidad: number;
  precio_venta: number;
  tipo_precio?: "minorista" | "mayorista" | "distribuidor" | null;
  tipo_iva?: "EXENTA" | "5%" | "10%" | null;
  presentacion_id?: string | null;
  presentacion_nombre?: string | null;
  presentacion_cantidad_base?: number | null;
}

interface PatchBody {
  cliente_id?: string | null;
  cliente_nombre?: string | null;
  cliente_telefono?: string | null;
  observacion?: string | null;
  items?: BodyItem[];
}

export async function PATCH(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase: sb, auth } = ctx;
    const empresaId = auth.empresa_id;

    // Verificar estado actual antes de tocar nada.
    const cur = await sb
      .from("pedidos_caja")
      .select("estado, numero, cliente_nombre")
      .eq("empresa_id", empresaId)
      .eq("id", id)
      .maybeSingle();
    if (cur.error) throw new Error(cur.error.message);
    if (!cur.data) return NextResponse.json(errorResponse("Pedido no encontrado."), { status: 404 });
    const estadoActual = (cur.data as { estado: string }).estado;
    if (estadoActual === "facturado") {
      return NextResponse.json(
        errorResponse("El pedido ya fue facturado, no se puede editar."),
        { status: 409 }
      );
    }
    if (estadoActual === "cancelado") {
      return NextResponse.json(
        errorResponse("El pedido está cancelado, no se puede editar."),
        { status: 409 }
      );
    }

    const body = (await request.json().catch(() => null)) as PatchBody | null;
    if (!body) return NextResponse.json(errorResponse("Body inválido."), { status: 400 });

    const patch: Record<string, unknown> = {};

    if (body.cliente_id !== undefined) patch.cliente_id = body.cliente_id || null;
    if (body.cliente_nombre !== undefined)
      patch.cliente_nombre = (body.cliente_nombre ?? "").trim() || null;
    if (body.cliente_telefono !== undefined)
      patch.cliente_telefono = (body.cliente_telefono ?? "").trim() || null;
    if (body.observacion !== undefined)
      patch.observacion = (body.observacion ?? "").trim() || null;

    if (Array.isArray(body.items)) {
      const items = body.items
        .filter((it) => it && it.producto_id && Number(it.cantidad) > 0)
        .map((it) => ({
          producto_id: String(it.producto_id),
          producto_nombre: String(it.producto_nombre ?? ""),
          sku: it.sku ?? null,
          cantidad: Number(it.cantidad),
          precio_venta: Math.max(0, Number(it.precio_venta) || 0),
          tipo_precio:
            it.tipo_precio === "mayorista" || it.tipo_precio === "distribuidor"
              ? it.tipo_precio
              : "minorista",
          tipo_iva:
            it.tipo_iva === "EXENTA" || it.tipo_iva === "5%" || it.tipo_iva === "10%"
              ? it.tipo_iva
              : "10%",
          presentacion_id: it.presentacion_id ?? null,
          presentacion_nombre: it.presentacion_nombre ?? null,
          presentacion_cantidad_base:
            it.presentacion_cantidad_base != null
              ? Number(it.presentacion_cantidad_base)
              : null,
        }));
      if (items.length === 0) {
        return NextResponse.json(
          errorResponse("El pedido debe tener al menos un producto válido."),
          { status: 400 }
        );
      }
      patch.items = items;
      patch.total_estimado = items.reduce((s, it) => s + it.cantidad * it.precio_venta, 0);
      // Re-armar titulo con el numero ya asignado para mantenerlo coherente.
      const numero = (cur.data as { numero: string | null }).numero ?? "Pedido";
      const cliNombreFinal =
        body.cliente_nombre !== undefined
          ? (body.cliente_nombre ?? "").trim() || null
          : (cur.data as { cliente_nombre: string | null }).cliente_nombre;
      patch.titulo = cliNombreFinal
        ? `${numero} - ${cliNombreFinal}`
        : `${numero} - ${items.length} producto${items.length === 1 ? "" : "s"}`;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(errorResponse("No hay cambios para aplicar."), { status: 400 });
    }

    const upd = await sb
      .from("pedidos_caja")
      .update(patch)
      .eq("empresa_id", empresaId)
      .eq("id", id)
      .in("estado", ["pendiente", "en_caja"])
      .select(PEDIDO_CAJA_COLS)
      .single();
    if (upd.error) throw new Error(upd.error.message);

    return NextResponse.json(
      successResponse({ pedido: mapPedidoCaja((upd.data as unknown) as Record<string, unknown>) })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo editar el pedido.";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase: sb, auth } = ctx;

    const url = new URL(request.url);
    const motivo = (url.searchParams.get("motivo") ?? "").trim().slice(0, 500) || null;

    // Cancelable desde pendiente O en_caja (no desde facturado / cancelado).
    const upd = await sb
      .from("pedidos_caja")
      .update({
        estado: "cancelado",
        cancelado_por_id: auth.usuarioCatalogId ?? null,
        cancelado_motivo: motivo,
        cancelado_at: new Date().toISOString(),
      })
      .eq("empresa_id", auth.empresa_id)
      .eq("id", id)
      .in("estado", ["pendiente", "en_caja"]);
    if (upd.error) return NextResponse.json(errorResponse(upd.error.message), { status: 400 });

    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo cancelar el pedido.";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
