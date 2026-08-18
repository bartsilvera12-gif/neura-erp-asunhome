import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { emitEvent, EVENT_TYPES } from "@/lib/integrations/events";
import { crearFacturaInicialSuscripcionSiCorresponde } from "@/lib/facturacion/factura-suscripcion-servidor";


export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;

    const { searchParams } = new URL(request.url);
    const clienteId = searchParams.get("cliente_id");

    let query = supabase
      .from("suscripciones")
      .select("*, planes(nombre)")
      .eq("empresa_id", auth.empresa_id)
      .order("created_at", { ascending: false });

    if (clienteId) {
      query = query.eq("cliente_id", clienteId);
    }

    let { data, error } = await query;
    if (error) {
      const q2 = supabase
        .from("suscripciones")
        .select("*")
        .eq("empresa_id", auth.empresa_id)
        .order("created_at", { ascending: false });
      const q2f = clienteId ? q2.eq("cliente_id", clienteId) : q2;
      const r2 = await q2f;
      if (r2.error) {
        return NextResponse.json(errorResponse(error.message), { status: 400 });
      }
      data = r2.data;
      error = null;
    }

    return NextResponse.json(successResponse(data ?? []));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;

    const body = await request.json();
    const { cliente_id, plan_id, precio, moneda, fecha_inicio, duracion_meses, dia_facturacion, dia_vencimiento, generar_factura_este_mes } = body;

    if (!cliente_id?.trim()) {
      return NextResponse.json(errorResponse("cliente_id es obligatorio"), { status: 400 });
    }
    if (precio == null || Number(precio) < 0) {
      return NextResponse.json(errorResponse("precio debe ser >= 0"), { status: 400 });
    }
    if (!fecha_inicio) {
      return NextResponse.json(errorResponse("fecha_inicio es obligatoria"), { status: 400 });
    }

    const insert = {
      empresa_id: auth.empresa_id,
      cliente_id: cliente_id.trim(),
      plan_id: plan_id?.trim() || null,
      precio: Number(precio),
      moneda: moneda === "USD" ? "USD" : "GS",
      fecha_inicio,
      duracion_meses: Number(duracion_meses) || 12,
      dia_facturacion: Math.min(28, Math.max(1, Number(dia_facturacion) || 1)),
      dia_vencimiento: Math.min(31, Math.max(1, Number(dia_vencimiento) || 10)),
      generar_factura_este_mes: Boolean(generar_factura_este_mes),
    };

    const { data, error } = await supabase.from("suscripciones").insert([insert]).select("*").single();

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }

    console.log("[API] About to emit event");
    await emitEvent(EVENT_TYPES.suscripcion_creada, { suscripcion_id: data.id, cliente_id: data.cliente_id });

    if (insert.generar_factura_este_mes) {
      await crearFacturaInicialSuscripcionSiCorresponde({
        supabase,
        empresaId: auth.empresa_id,
        suscripcion: {
          id: data.id,
          cliente_id: data.cliente_id,
          plan_id: data.plan_id,
          precio: Number(data.precio),
          moneda: data.moneda,
          dia_facturacion: data.dia_facturacion,
          dia_vencimiento: data.dia_vencimiento,
        },
      });
    }

    return NextResponse.json(successResponse(data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
