import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

export type RevendedorStatsPayload = {
  clicks: number;
  clicks_redeemed: number;
  sesiones_atribuidas: number;
  ordenes: number;
  monto_total: number;
  cupones: number;
};

/**
 * GET /api/sorteos/revendedores/:revId/stats — métricas de referidos (PG shim).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ revId: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const empresaId = ctx.auth.empresa_id;
    const { revId } = await params;
    const revendedorId = revId.trim();
    if (!revendedorId) {
      return NextResponse.json(errorResponse("Revendedor inválido."), { status: 400 });
    }

    const sb = await getChatServiceClientForEmpresa(empresaId);

    // Las 4 queries no dependen entre si => Promise.all las ejecuta en paralelo.
    // Antes: 4x latencia serial (cada await espera a la anterior).
    // Ahora: max(t1, t2, t3, t4) = 4x mas rapido en promedio.
    const [r1, r2, r3, r4] = await Promise.all([
      sb
        .from("sorteo_revendedor_clicks")
        .select("id", { count: "exact", head: true })
        .eq("revendedor_id", revendedorId)
        .eq("empresa_id", empresaId),
      sb
        .from("sorteo_revendedor_clicks")
        .select("id", { count: "exact", head: true })
        .eq("revendedor_id", revendedorId)
        .eq("empresa_id", empresaId)
        .not("redeemed_at", "is", null),
      sb
        .from("chat_flow_sessions")
        .select("id", { count: "exact", head: true })
        .eq("revendedor_id", revendedorId)
        .eq("empresa_id", empresaId),
      sb
        .from("sorteo_entradas")
        .select("id, monto_total, cantidad_boletos")
        .eq("revendedor_id", revendedorId)
        .eq("empresa_id", empresaId),
    ]);

    const { count: clicks, error: e1 } = r1;
    if (e1) return NextResponse.json(errorResponse(e1.message), { status: 400 });
    const { count: clicksRedeemed, error: e2 } = r2;
    if (e2) return NextResponse.json(errorResponse(e2.message), { status: 400 });
    const { count: sesiones, error: e3 } = r3;
    if (e3) return NextResponse.json(errorResponse(e3.message), { status: 400 });
    const { data: ordenesRows, error: e4 } = r4;
    if (e4) return NextResponse.json(errorResponse(e4.message), { status: 400 });

    const ordenes = ordenesRows?.length ?? 0;
    let monto_total = 0;
    let cupones = 0;
    for (const r of ordenesRows ?? []) {
      const row = r as { monto_total?: unknown; cantidad_boletos?: unknown };
      const m = Number(row.monto_total);
      if (Number.isFinite(m)) monto_total += m;
      const c = Number(row.cantidad_boletos);
      if (Number.isFinite(c) && c > 0) cupones += Math.trunc(c);
    }

    const payload: RevendedorStatsPayload = {
      clicks: clicks ?? 0,
      clicks_redeemed: clicksRedeemed ?? 0,
      sesiones_atribuidas: sesiones ?? 0,
      ordenes,
      monto_total,
      cupones,
    };

    return NextResponse.json(successResponse(payload));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
