import { NextRequest, NextResponse } from "next/server";
import { getFacturasSupabaseFromAuth } from "@/lib/facturacion/facturas-service-client";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { emitEvent, EVENT_TYPES } from "@/lib/integrations/events";
import { montosFacturaItemParaInsert } from "@/lib/facturacion/factura-item-montos";
import { obtenerSiguienteNumeroFacturaEmpresa } from "@/lib/facturacion/factura-suscripcion-servidor";
import { aplicarPlanPendienteSiVencido } from "@/lib/facturacion/suscripcion-plan-pendiente";
import { fechaVencimientoSuscripcion } from "@/lib/fechas/calendario";


/**
 * POST /api/clientes/:id/facturacion/emitir
 * Emite factura manualmente para un mes de la suscripción.
 * Body: { mes: "YYYY-MM" }
 * - Si ya existe factura para ese mes → error
 * - Si no existe → crea factura
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getFacturasSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;

    const { id: clienteId } = await params;
    if (!clienteId) {
      return NextResponse.json(errorResponse("cliente_id es obligatorio"), { status: 400 });
    }

    const body = await request.json();
    const mes = body?.mes?.trim();
    if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
      return NextResponse.json(
        errorResponse("mes es obligatorio en formato YYYY-MM"),
        { status: 400 }
      );
    }


    const { data: suscripcion, error: errSusc } = await supabase
      .from("suscripciones")
      .select("*")
      .eq("cliente_id", clienteId)
      .eq("empresa_id", auth.empresa_id)
      .eq("estado", "activa")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (errSusc) {
      return NextResponse.json(errorResponse(errSusc.message), { status: 400 });
    }

    if (!suscripcion) {
      return NextResponse.json(
        errorResponse("No hay suscripción activa para este cliente"),
        { status: 404 }
      );
    }

    await aplicarPlanPendienteSiVencido({
      supabase,
      empresaId: auth.empresa_id,
      suscripcionId: suscripcion.id,
    });
    const { data: subAct } = await supabase
      .from("suscripciones")
      .select("*")
      .eq("id", suscripcion.id)
      .eq("empresa_id", auth.empresa_id)
      .single();
    const susUso = subAct ?? suscripcion;

    const [year, month] = mes.split("-").map(Number);
    const diaFact = Math.min(susUso.dia_facturacion ?? 1, 28);
    const diaVencCfg = Math.min(Math.max(1, susUso.dia_vencimiento ?? 10), 31);

    const fecha = `${year}-${String(month).padStart(2, "0")}-${String(diaFact).padStart(2, "0")}`;
    const fechaVenc = fechaVencimientoSuscripcion(fecha, diaVencCfg);

    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const mesSiguiente = `${nextYear}-${String(nextMonth).padStart(2, "0")}`;

    const { data: existentes } = await supabase
      .from("facturas")
      .select("id")
      .eq("cliente_id", clienteId)
      .eq("suscripcion_id", susUso.id)
      .eq("empresa_id", auth.empresa_id)
      .gte("fecha", `${mes}-01`)
      .lt("fecha", `${mesSiguiente}-01`)
      .limit(1);

    if (existentes && existentes.length > 0) {
      return NextResponse.json(
        errorResponse("Ya existe una factura emitida para este mes"),
        { status: 409 }
      );
    }

    const numeroFactura = await obtenerSiguienteNumeroFacturaEmpresa(supabase, auth.empresa_id);
    const monto = Number(susUso.precio);
    const moneda = susUso.moneda === "USD" ? "USD" : "GS";

    const { data: factura, error: errFact } = await supabase
      .from("facturas")
      .insert({
        empresa_id: auth.empresa_id,
        cliente_id: clienteId,
        suscripcion_id: susUso.id,
        numero_factura: numeroFactura,
        fecha,
        fecha_vencimiento: fechaVenc,
        monto,
        saldo: monto,
        estado: "Pendiente",
        tipo: "suscripcion",
        moneda,
      })
      .select()
      .single();

    if (errFact) {
      return NextResponse.json(errorResponse(errFact.message), { status: 400 });
    }

    let planNombre = "Suscripción";
    if (susUso.plan_id) {
      const { data: plan } = await supabase
        .from("planes")
        .select("nombre")
        .eq("id", susUso.plan_id)
        .maybeSingle();
      if (plan?.nombre) planNombre = plan.nombre;
    }
    const linea = montosFacturaItemParaInsert({
      totalLinea: monto,
      moneda,
      cantidad: 1,
      precioUnitario: monto,
    });
    const { error: errItem } = await supabase.from("factura_items").insert({
      factura_id: factura.id,
      empresa_id: auth.empresa_id,
      descripcion: planNombre,
      cantidad: 1,
      precio_unitario: linea.precio_unitario,
      subtotal: linea.subtotal,
      iva: linea.iva,
      total: linea.total,
    });

    if (errItem) {
      console.error("[facturacion] factura_items:", errItem.message);
      await supabase.from("facturas").delete().eq("id", factura.id).eq("empresa_id", auth.empresa_id);
      return NextResponse.json(
        errorResponse(
          `No se pudo registrar el detalle de la factura: ${errItem.message}. La operación fue cancelada.`
        ),
        { status: 400 }
      );
    }

    await emitEvent(EVENT_TYPES.factura_creada, {
      factura_id: factura.id,
      cliente_id: clienteId,
      monto: factura.monto,
    });

    return NextResponse.json(
      successResponse({
        factura: {
          id: factura.id,
          numero_factura: factura.numero_factura,
          fecha: factura.fecha,
          monto: factura.monto,
        },
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
