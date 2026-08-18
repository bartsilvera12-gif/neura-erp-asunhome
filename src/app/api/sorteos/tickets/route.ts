import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * GET /api/sorteos/tickets — lista entregas de tickets (reservorio).
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const empresaId = ctx.auth.empresa_id;
    const url = new URL(request.url);
    const sorteoId = url.searchParams.get("sorteo_id")?.trim() || "";
    const status = url.searchParams.get("status")?.trim() || "";
    const q = url.searchParams.get("q")?.trim().toLowerCase() || "";

    const sb = await getChatServiceClientForEmpresa(empresaId);
    let query = sb
      .from("sorteo_ticket_deliveries")
      .select("*")
      .eq("empresa_id", empresaId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (sorteoId) query = query.eq("sorteo_id", sorteoId);
    if (status && ["pending", "generated", "sent", "error"].includes(status)) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) {
      const hint =
        /sorteo_ticket_deliveries|does not exist|relation/i.test(error.message)
          ? " Verificá que la migración sorteo_ticket_deliveries esté aplicada en el schema tenant (erp_*)."
          : "";
      console.error("[api/sorteos/tickets] list_error", { empresaId, message: error.message });
      return NextResponse.json(errorResponse(`${error.message}${hint}`), { status: 400 });
    }
    let rows = data ?? [];
    if (q) {
      rows = rows.filter((r: Record<string, unknown>) => {
        const pack = JSON.stringify(r).toLowerCase();
        return pack.includes(q);
      });
    }
    return NextResponse.json(successResponse(rows));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
