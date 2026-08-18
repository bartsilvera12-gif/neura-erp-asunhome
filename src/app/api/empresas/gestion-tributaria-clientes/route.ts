import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/middleware/auth";
import { errorResponse, successResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { getGestionTributariaClientes, setGestionTributariaClientes } from "@/lib/empresa/gestion-tributaria-catalog";

/**
 * GET: bandera de la empresa autenticada (cualquier usuario con acceso a la empresa).
 * PATCH: actualizar (solo administradores de la empresa).
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth } = ctx;
    const on = await getGestionTributariaClientes(auth.empresa_id);
    return NextResponse.json(successResponse({ gestion_tributaria_clientes: on }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    if (!isAdmin(ctx.auth)) {
      return NextResponse.json(errorResponse("Solo un administrador puede modificar esta opción"), { status: 403 });
    }
    const body = await request.json().catch(() => ({}));
    const v = body.gestion_tributaria_clientes;
    if (typeof v !== "boolean") {
      return NextResponse.json(errorResponse("gestion_tributaria_clientes (boolean) es obligatorio"), { status: 400 });
    }
    await setGestionTributariaClientes(ctx.auth.empresa_id, v);
    return NextResponse.json(successResponse({ gestion_tributaria_clientes: v }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
