import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { anularDevolucion } from "@/lib/devoluciones/server/devoluciones-pg";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";

/**
 * POST /api/ventas/[id]/anular
 *
 * Anula una venta ACTIVA que pertenezca a una caja ACTUALMENTE ABIERTA.
 * Reversos aplicados en una sola pasada (best-effort en Supabase JS; sin
 * transaccion distribuida — el orden y la idempotencia protegen re-tries):
 *
 *  1. Devuelve stock: por cada movimientos_inventario SALIDA de esta venta
 *     que aun no este anulado, suma la cantidad al productos.stock_actual
 *     y marca el movimiento anulado_at.
 *  2. Anula los caja_movimientos vinculados a la venta (venta_id).
 *  3. Marca la venta con estado='ANULADA', anulada_at, anulada_por, motivo.
 *
 * Body: { motivo?: string }
 * Requisitos:
 *  - Venta en estado ACTIVA (idempotente: si ya esta ANULADA -> 409).
 *  - venta.caja_id apunta a una caja en estado 'abierta' (regla "solo actuales").
 */
export async function POST(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id: ventaId } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const motivoRaw = (body as { motivo?: unknown } | null)?.motivo;
    const motivo = motivoRaw == null ? null : String(motivoRaw).trim() || null;

    const sb = ctx.supabase;
    const empresaId = ctx.auth.empresa_id;
    const usuarioId = ctx.auth.usuarioCatalogId ?? null;

    // 1) Traer venta y validar
    const { data: venta, error: eV } = await sb
      .from("ventas")
      .select("id, numero_control, estado, caja_id")
      .eq("id", ventaId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (eV) throw new Error(eV.message);
    if (!venta) return NextResponse.json(errorResponse("Venta no encontrada."), { status: 404 });
    if (venta.estado === "anulada") {
      return NextResponse.json(errorResponse("La venta ya está anulada."), { status: 409 });
    }

    // 2) Validar caja abierta (regla: solo se pueden anular ventas de caja actual)
    if (!venta.caja_id) {
      return NextResponse.json(
        errorResponse("No se puede anular: la venta no tiene caja asociada."),
        { status: 400 }
      );
    }
    const { data: caja, error: eC } = await sb
      .from("cajas")
      .select("id, estado")
      .eq("id", venta.caja_id)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (eC) throw new Error(eC.message);
    if (!caja || caja.estado !== "abierta") {
      return NextResponse.json(
        errorResponse("No se puede anular: la caja de esta venta ya está cerrada."),
        { status: 400 }
      );
    }

    // 2b) Si la venta tiene devoluciones confirmadas, anularlas primero (cascada).
    // Cada anularDevolucion revierte su reintegro de stock y su caja_movimiento.
    // Luego, en el paso 4, se revierten solo los movimientos de origen 'venta' (evita doble conteo).
    const { data: devs, error: eDevs } = await sb
      .from("devoluciones_venta")
      .select("id")
      .eq("empresa_id", empresaId)
      .eq("venta_id", ventaId)
      .eq("estado", "confirmada");
    if (eDevs) throw new Error(eDevs.message);
    if (devs && devs.length > 0) {
      const schema = await fetchDataSchemaForEmpresaId(empresaId);
      for (const d of devs) {
        await anularDevolucion(
          schema,
          empresaId,
          { id: usuarioId, nombre: ctx.auth.nombre ?? ctx.auth.user?.email ?? null },
          String(d.id),
          "Anulación de venta"
        );
      }
    }

    // 3) Traer movimientos de inventario de esta venta aun activos.
    // Filtramos por origen='venta' para no re-revertir las SALIDAs que ya creo
    // el anular-devolucion (origen='devolucion_venta').
    const { data: movs, error: eM } = await sb
      .from("movimientos_inventario")
      .select("id, producto_id, producto_nombre, producto_sku, cantidad, costo_unitario, tipo, anulado_at, origen")
      .eq("empresa_id", empresaId)
      .eq("venta_id", ventaId);
    if (eM) throw new Error(eM.message);

    const movsActivos = (movs ?? []).filter(
      (m) => !m.anulado_at && m.tipo === "SALIDA" && (m.origen ?? "venta") === "venta"
    );

    // 4) Devolver stock producto por producto + crear ENTRADA contra-movimiento
    const nowIso = new Date().toISOString();
    for (const m of movsActivos) {
      // Leer stock actual (evita RACE mínimas dentro de la misma request)
      const { data: prod, error: eP } = await sb
        .from("productos")
        .select("stock_actual")
        .eq("id", m.producto_id)
        .eq("empresa_id", empresaId)
        .maybeSingle();
      if (eP) throw new Error(eP.message);
      const stockActual = Number(prod?.stock_actual ?? 0);
      const cantidad = Number(m.cantidad ?? 0);
      const nuevoStock = stockActual + cantidad;

      const { error: eUp } = await sb
        .from("productos")
        .update({ stock_actual: nuevoStock })
        .eq("id", m.producto_id)
        .eq("empresa_id", empresaId);
      if (eUp) throw new Error(eUp.message);

      // Marcar la SALIDA original como anulada (auditoría; no se borra).
      const { error: eMarcar } = await sb
        .from("movimientos_inventario")
        .update({ anulado_at: nowIso, anulado_por: usuarioId })
        .eq("id", m.id)
        .eq("empresa_id", empresaId);
      if (eMarcar) throw new Error(eMarcar.message);

      // Crear ENTRADA contra-movimiento visible en el listado de movimientos.
      const { error: eIns } = await sb.from("movimientos_inventario").insert({
        empresa_id: empresaId,
        producto_id: m.producto_id,
        producto_nombre: m.producto_nombre,
        producto_sku: m.producto_sku,
        tipo: "ENTRADA",
        cantidad,
        costo_unitario: m.costo_unitario,
        origen: "ajuste_manual",
        referencia: `ANUL-${venta.numero_control}`,
        fecha: nowIso,
        venta_id: ventaId,
        created_by: usuarioId,
      });
      if (eIns) throw new Error(eIns.message);
    }

    // 5) Anular movimientos de caja vinculados a esta venta
    const { error: eCaja } = await sb
      .from("caja_movimientos")
      .update({ anulado_at: nowIso, anulado_por: usuarioId })
      .eq("empresa_id", empresaId)
      .eq("venta_id", ventaId)
      .is("anulado_at", null);
    if (eCaja) throw new Error(eCaja.message);

    // 5b) Si la venta era a credito, anular la cuenta por cobrar asociada.
    // No falla si no existe (venta contado): update sin filas afectadas.
    const { error: eCxc } = await sb
      .from("cuentas_por_cobrar")
      .update({ estado: "anulado", saldo: 0 })
      .eq("empresa_id", empresaId)
      .eq("venta_id", ventaId)
      .neq("estado", "anulado");
    if (eCxc) throw new Error(eCxc.message);

    // 6) Marcar la venta como ANULADA
    const { error: eV2 } = await sb
      .from("ventas")
      .update({
        estado: "anulada",
        anulada_at: nowIso,
        anulada_por: usuarioId,
        anulada_motivo: motivo,
      })
      .eq("id", ventaId)
      .eq("empresa_id", empresaId);
    if (eV2) throw new Error(eV2.message);

    return NextResponse.json(
      successResponse({
        ok: true,
        venta_id: ventaId,
        movimientos_revertidos: movsActivos.length,
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo anular la venta.";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
