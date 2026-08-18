import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import { maybeGenerateAndSendSorteoTicketDelivery } from "@/lib/sorteos/sorteo-ticket-delivery";
import { buildOrderResultFromEntradaId, flowDataStubFromEntrada } from "@/lib/sorteos/sorteo-ticket-admin";

export const runtime = "nodejs";

type Body = {
  empresaId: string;
  entradaId: string;
  conversationId: string;
  channelId: string;
  dryRun?: boolean;
};

/**
 * POST — prueba técnica de entrega de ticket (mismo stack que el flow).
 * Requiere `QA_SORTEO_TICKET_SECRET` en el servidor y header Authorization: Bearer <secret>.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.QA_SORTEO_TICKET_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ ok: false, error: "QA_SORTEO_TICKET_SECRET no configurado" }, { status: 503 });
  }
  const auth = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (auth !== secret) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }

  const empresaId = String(body.empresaId ?? "").trim();
  const entradaId = String(body.entradaId ?? "").trim();
  const conversationId = String(body.conversationId ?? "").trim();
  const channelId = String(body.channelId ?? "").trim();
  const dryRun = Boolean(body.dryRun);

  if (!empresaId || !entradaId || !conversationId || !channelId) {
    return NextResponse.json(
      { ok: false, error: "Faltan empresaId, entradaId, conversationId o channelId" },
      { status: 400 }
    );
  }

  try {
    const sb = await getChatServiceClientForEmpresa(empresaId);

    const { data: conv, error: convErr } = await sb
      .from("chat_conversations")
      .select("contact_id, active_flow_session_id")
      .eq("id", conversationId)
      .maybeSingle();
    if (convErr || !conv) {
      return NextResponse.json(
        { ok: false, error: `chat_conversations: ${convErr?.message ?? "sin fila"}` },
        { status: 400 }
      );
    }
    const contactId = String((conv as { contact_id?: string }).contact_id ?? "").trim();
    const flowSessionId = String(
      (conv as { active_flow_session_id?: string | null }).active_flow_session_id ?? ""
    ).trim();

    const orderResult = await buildOrderResultFromEntradaId(sb, entradaId, empresaId);
    const flowData = await flowDataStubFromEntrada(sb, entradaId);
    if (!orderResult) {
      return NextResponse.json({ ok: false, error: "entrada_not_found" }, { status: 400 });
    }

    const result = await maybeGenerateAndSendSorteoTicketDelivery({
      supabase: sb,
      empresaId,
      sorteoId: orderResult.sorteoId,
      entradaId: orderResult.entradaId,
      conversationId,
      flowSessionId: flowSessionId || null,
      contactId,
      channelId,
      orderResult,
      flowData,
      trigger: "comprobante_imagen",
      skipWhatsApp: dryRun,
    });

    const { data: rows } = await sb
      .from("sorteo_ticket_deliveries")
      .select(
        "id, status, storage_bucket, storage_path, whatsapp_message_id, error_message, provider, channel_id"
      )
      .eq("entrada_id", entradaId)
      .order("created_at", { ascending: false })
      .limit(5);

    return NextResponse.json({ ok: true, result, deliveries: rows ?? [] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/qa/sorteo-ticket-delivery]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
