import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { resendSorteoTicketByDeliveryId } from "@/lib/sorteos/sorteo-ticket-delivery";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const empresaId = ctx.auth.empresa_id;
    const { id } = await params;
    const sb = await getChatServiceClientForEmpresa(empresaId);

    const r = await resendSorteoTicketByDeliveryId({
      supabase: sb,
      empresaId,
      deliveryId: id,
    });
    if (!r.ok) {
      const st =
        r.error === "not_found" ? 404 : r.error === "no_file" || r.error === "no_conversation" ? 400 : 500;
      return NextResponse.json(errorResponse(r.error ?? "failed"), { status: st });
    }
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
