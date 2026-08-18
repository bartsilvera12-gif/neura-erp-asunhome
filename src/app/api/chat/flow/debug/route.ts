import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { getAuthWithRol } from "@/lib/middleware/auth";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthWithRol(request);
    if (!auth?.empresa_id) {
      return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
    }

    const conversationId =
      request.nextUrl.searchParams.get("conversation_id")?.trim() ?? "";
    if (!conversationId) {
      return NextResponse.json(
        { ok: false, error: "conversation_id es requerido" },
        { status: 400 }
      );
    }

    const supabase = await getChatServiceClientForEmpresa(auth.empresa_id);
    const { data: conversation, error: convErr } = await supabase
      .from("chat_conversations")
      .select(
        "id, empresa_id, channel_id, contact_id, flow_code, flow_current_node, flow_status, human_taken_over, status, last_message_at, unread_count"
      )
      .eq("id", conversationId)
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();
    if (convErr) {
      return NextResponse.json({ ok: false, error: convErr.message }, { status: 400 });
    }
    if (!conversation) {
      return NextResponse.json(
        { ok: false, error: "Conversación no encontrada" },
        { status: 404 }
      );
    }

    const { data: events, error: evErr } = await supabase
      .from("chat_flow_events")
      .select(
        "id, flow_code, node_code, event_type, selected_option_id, meta_button_id, payload, created_at"
      )
      .eq("empresa_id", auth.empresa_id)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (evErr) {
      return NextResponse.json({ ok: false, error: evErr.message }, { status: 400 });
    }

    const { data: messages, error: msgErr } = await supabase
      .from("chat_messages")
      .select(
        "id, wa_message_id, from_me, sender_type, sent_by_user_id, sent_by_user_name, automation_source, message_type, content, raw_payload, created_at"
      )
      .eq("empresa_id", auth.empresa_id)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (msgErr) {
      return NextResponse.json({ ok: false, error: msgErr.message }, { status: 400 });
    }

    const { data: contact } = await supabase
      .from("chat_contacts")
      .select("id, name, phone_number, phone_normalized, cliente_id, crm_prospecto_id")
      .eq("id", conversation.contact_id as string)
      .maybeSingle();

    const { data: channel } = await supabase
      .from("chat_channels")
      .select("id, nombre, type, meta_phone_number_id, provider, provider_channel_id, activo")
      .eq("id", conversation.channel_id as string)
      .maybeSingle();

    return NextResponse.json({
      ok: true,
      conversation_id: conversation.id,
      flow_code: conversation.flow_code,
      flow_current_node: conversation.flow_current_node,
      flow_status: conversation.flow_status,
      human_taken_over: conversation.human_taken_over,
      conversation,
      contact: contact ?? null,
      channel: channel ?? null,
      events: events ?? [],
      messages: messages ?? [],
    });
  } catch (e) {
    console.error("[api/chat/flow/debug]", e);
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}
