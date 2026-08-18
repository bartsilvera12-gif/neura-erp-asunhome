import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { cargarContextoCambioPlanCliente, ejecutarCambioPlanCliente } from "@/lib/facturacion/cambio-plan-cliente-servidor";
import type { ModoCambioPlan } from "@/lib/facturacion/cambio-plan-cliente-types";

/**
 * GET /api/clientes/:id/cambio-plan
 * Contexto para el modal: planes, plan actual, factura del mes, SIFEN, modos permitidos.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(_request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { id: clienteId } = await params;
    if (!clienteId) {
      return NextResponse.json(errorResponse("id es obligatorio"), { status: 400 });
    }

    const { data: cli } = await ctx.supabase
      .from("clientes")
      .select("id, empresa_id")
      .eq("id", clienteId)
      .eq("empresa_id", ctx.auth.empresa_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!cli) {
      return NextResponse.json(errorResponse("Cliente no encontrado"), { status: 404 });
    }

    const payload = await cargarContextoCambioPlanCliente(ctx.supabase, ctx.auth, clienteId);
    return NextResponse.json(successResponse(payload));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al cargar cambio de plan";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

const MODOS: ModoCambioPlan[] = ["inmediato", "proximo_mes", "actualizar_factura_pendiente"];

/**
 * POST /api/clientes/:id/cambio-plan
 * Body: { plan_id, modo }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { id: clienteId } = await params;
    if (!clienteId) {
      return NextResponse.json(errorResponse("id es obligatorio"), { status: 400 });
    }

    const { data: cli } = await ctx.supabase
      .from("clientes")
      .select("id, empresa_id")
      .eq("id", clienteId)
      .eq("empresa_id", ctx.auth.empresa_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!cli) {
      return NextResponse.json(errorResponse("Cliente no encontrado"), { status: 404 });
    }

    const body = await request.json();
    const planId = String(body?.plan_id ?? "").trim();
    const modo = String(body?.modo ?? "").trim() as ModoCambioPlan;
    if (!planId) {
      return NextResponse.json(errorResponse("plan_id es obligatorio"), { status: 400 });
    }
    if (!MODOS.includes(modo)) {
      return NextResponse.json(errorResponse("modo de aplicación no válido"), { status: 400 });
    }

    const payload = await ejecutarCambioPlanCliente(ctx.supabase, ctx.auth, {
      clienteId,
      planId,
      modo,
    });
    return NextResponse.json(successResponse(payload));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al cambiar de plan";
    return NextResponse.json(errorResponse(msg), { status: 400 });
  }
}
