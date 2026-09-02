/** POST /api/reservas/[id]/cancelar — cancela y devuelve al stock lo no entregado. */
import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { cancelarReserva } from "@/lib/reservas/server/reservas-pg";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const { id } = await params;
    await cancelarReserva(schema, ctx.auth.empresa_id, id, { id: ctx.auth.usuarioCatalogId ?? null, nombre: ctx.auth.nombre ?? ctx.auth.user?.email ?? null });
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo cancelar la reserva.";
    console.error("[/api/reservas/[id]/cancelar POST]", msg);
    return NextResponse.json(errorResponse(msg), { status: /no encontrada|activa/i.test(msg) ? 400 : 500 });
  }
}
