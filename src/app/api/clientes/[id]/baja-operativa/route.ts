import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/middleware/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";


/**
 * GET /api/clientes/:id/baja-operativa
 * Obtiene info previa: suscripciones activas, factura pendiente del mes.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;

    const { id: clienteId } = await params;
    if (!clienteId) {
      return NextResponse.json(errorResponse("id es obligatorio"), { status: 400 });
    }

    const { data: cliente } = await supabase
      .from("clientes")
      .select("id, empresa_id, estado, baja_operativa_at")
      .eq("id", clienteId)
      .eq("empresa_id", auth.empresa_id)
      .is("deleted_at", null)
      .single();

    if (!cliente) {
      return NextResponse.json(errorResponse("Cliente no encontrado"), { status: 404 });
    }

    if (cliente.estado === "inactivo") {
      return NextResponse.json(errorResponse("El cliente ya está dado de baja"), { status: 400 });
    }

    const [suscRes, factRes] = await Promise.all([
      supabase
        .from("suscripciones")
        .select("id, precio, moneda")
        .eq("cliente_id", clienteId)
        .eq("empresa_id", auth.empresa_id)
        .eq("estado", "activa"),
      supabase
        .from("facturas")
        .select("id, numero_factura, monto, saldo, fecha, estado")
        .eq("cliente_id", clienteId)
        .eq("empresa_id", auth.empresa_id)
        .neq("estado", "Anulado")
        .gt("saldo", 0)
        .order("fecha", { ascending: false }),
    ]);

    const suscripcionesActivas = suscRes.data ?? [];
    const facturasPendientes = factRes.data ?? [];

    return NextResponse.json(successResponse({
      suscripciones_activas: suscripcionesActivas.length,
      facturas_pendientes_count: facturasPendientes.length,
      factura_pendiente_mes:
        facturasPendientes.length > 0
          ? {
              id: facturasPendientes[0].id,
              numero_factura: facturasPendientes[0].numero_factura,
              monto: facturasPendientes[0].monto,
            }
          : null,
      suscripciones: suscripcionesActivas,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/**
 * POST /api/clientes/:id/baja-operativa
 * Da de baja operativa al cliente: estado inactivo, cancela suscripciones,
 * opcionalmente anula factura pendiente del mes.
 * Body: { motivo: string, anular_factura_pendiente?: boolean }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;

    if (!isAdmin(auth)) {
      return NextResponse.json(errorResponse("Solo usuarios administradores pueden dar de baja clientes"), { status: 403 });
    }

    const { id: clienteId } = await params;
    if (!clienteId) {
      return NextResponse.json(errorResponse("id es obligatorio"), { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const motivo = typeof body.motivo === "string" ? body.motivo.trim() : "";
    const anularFacturaPendiente = Boolean(body.anular_factura_pendiente);
    const cancelarSuscripciones = body.cancelar_suscripciones !== false;

    if (!motivo) {
      return NextResponse.json(errorResponse("El motivo es obligatorio"), { status: 400 });
    }


    const { data: cliente } = await supabase
      .from("clientes")
      .select("id, empresa_id, estado")
      .eq("id", clienteId)
      .eq("empresa_id", auth.empresa_id)
      .is("deleted_at", null)
      .single();

    if (!cliente) {
      return NextResponse.json(errorResponse("Cliente no encontrado"), { status: 404 });
    }

    if (cliente.estado === "inactivo") {
      return NextResponse.json(errorResponse("El cliente ya está dado de baja"), { status: 400 });
    }

    const { count: nSuscActivas } = await supabase
      .from("suscripciones")
      .select("id", { count: "exact", head: true })
      .eq("cliente_id", clienteId)
      .eq("empresa_id", auth.empresa_id)
      .eq("estado", "activa");

    if ((nSuscActivas ?? 0) > 0 && !cancelarSuscripciones) {
      return NextResponse.json(
        errorResponse(
          "Hay suscripciones activas. Confirme cancelarlas (cancelar_suscripciones: true) para dar de baja o gestione las suscripciones antes."
        ),
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    if (anularFacturaPendiente) {
      const { data: facturas } = await supabase
        .from("facturas")
        .select("id")
        .eq("cliente_id", clienteId)
        .eq("empresa_id", auth.empresa_id)
        .neq("estado", "Anulado")
        .gt("saldo", 0);

      // Antes: N UPDATEs serializados (uno por factura).
      // Ahora: un solo UPDATE con .in(ids). Mantiene el filtro de empresa_id por seguridad.
      const facturaIds = (facturas ?? []).map((f) => f.id);
      if (facturaIds.length > 0) {
        await supabase
          .from("facturas")
          .update({ estado: "Anulado", saldo: 0, updated_at: now })
          .in("id", facturaIds)
          .eq("empresa_id", auth.empresa_id);
      }
    }

    if (cancelarSuscripciones) {
      const { error: errSusc } = await supabase
        .from("suscripciones")
        .update({ estado: "cancelada" })
        .eq("cliente_id", clienteId)
        .eq("empresa_id", auth.empresa_id)
        .eq("estado", "activa");

      if (errSusc) {
        return NextResponse.json(errorResponse("Error al cancelar suscripciones: " + errSusc.message), { status: 500 });
      }
    }

    const { error: errCliente } = await supabase
      .from("clientes")
      .update({
        estado:                    "inactivo",
        baja_operativa_at:         now,
        baja_operativa_by_user_id: auth.user.id,
        baja_operativa_by_nombre:  auth.nombre ?? null,
        baja_operativa_motivo:     motivo,
        baja_operativa_anulo_factura: anularFacturaPendiente,
        updated_at:                now,
      })
      .eq("id", clienteId);

    if (errCliente) {
      return NextResponse.json(errorResponse("Error al actualizar cliente: " + errCliente.message), { status: 500 });
    }

    return NextResponse.json(successResponse({
      baja: true,
      suscripciones_canceladas: cancelarSuscripciones,
      factura_anulada: anularFacturaPendiente,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
