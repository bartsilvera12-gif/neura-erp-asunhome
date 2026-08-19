import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { listarCajas } from "@/lib/caja/server";

/**
 * GET /api/caja/historial?limit=50
 *
 * Lista historico de cajas (abiertas y cerradas), mas recientes primero.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const url = new URL(request.url);
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") ?? 50) || 50));

    const cajas = await listarCajas(ctx.supabase, ctx.auth.empresa_id, limit);
    return NextResponse.json(successResponse({ cajas }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo cargar el historial.";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
