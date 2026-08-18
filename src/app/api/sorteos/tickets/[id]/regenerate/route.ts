import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { createServiceRoleClientForEmpresa } from "@/lib/supabase/empresa-data-schema";
import {
  buildOrderResultFromEntradaId,
  flowDataStubFromEntrada,
} from "@/lib/sorteos/sorteo-ticket-admin";
import { maybeGenerateAndSendSorteoTicketDelivery } from "@/lib/sorteos/sorteo-ticket-delivery";

/**
 * POST — nueva revisión de PNG; no reenvía WhatsApp (el operador usa Reenviar).
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
    const empresaId = ctx.auth.empresa_id;
    const { id } = await params;

    const sbFlow = await getChatServiceClientForEmpresa(empresaId);
    const sb = await createServiceRoleClientForEmpresa(empresaId);

    const { data: prev, error } = await sb
      .from("sorteo_ticket_deliveries")
      .select("entrada_id, conversation_id")
      .eq("id", id)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (error || !prev) {
      return NextResponse.json(errorResponse("No encontrado"), { status: 404 });
    }

    const entradaId = (prev as { entrada_id: string }).entrada_id;
    await sb
      .from("sorteo_ticket_deliveries")
      .update({ is_current: false, updated_at: new Date().toISOString() })
      .eq("entrada_id", entradaId);

    const orderResult = await buildOrderResultFromEntradaId(sb, entradaId, empresaId);
    const fd = await flowDataStubFromEntrada(sb, entradaId);
    if (!orderResult) {
      return NextResponse.json(errorResponse("entrada_not_found"), { status: 400 });
    }

    const conversationId = (prev as { conversation_id?: string | null }).conversation_id ?? null;

    const r = await maybeGenerateAndSendSorteoTicketDelivery({
      supabase: sbFlow,
      empresaId,
      sorteoId: orderResult.sorteoId,
      entradaId,
      conversationId,
      flowSessionId: null,
      contactId: "",
      channelId: "",
      orderResult,
      flowData: fd,
      trigger: "confirmacion_final",
      skipWhatsApp: true,
    });

    return NextResponse.json(successResponse({ ok: r.ok !== false, skipped: r.skipped }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
