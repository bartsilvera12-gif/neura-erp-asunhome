import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { getAuthWithRol } from "@/lib/middleware/auth";

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthWithRol(request);
    if (!auth?.empresa_id) {
      return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      conversation_id?: string;
      mode?: "human" | "bot";
    };
    const conversationId = body.conversation_id?.trim() ?? "";
    const mode = body.mode;

    if (!conversationId || (mode !== "human" && mode !== "bot")) {
      return NextResponse.json(
        { ok: false, error: "Se requiere conversation_id y mode=human|bot" },
        { status: 400 }
      );
    }

    const supabase = await getChatServiceClientForEmpresa(auth.empresa_id);
    const patch =
      mode === "human"
        ? { flow_status: "human", human_taken_over: true }
        : { flow_status: "bot", human_taken_over: false };

    const { data, error } = await supabase
      .from("chat_conversations")
      .update({
        ...patch,
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId)
      .eq("empresa_id", auth.empresa_id)
      .select("id, flow_code, flow_current_node, flow_status, human_taken_over")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    if (!data) {
      return NextResponse.json(
        { ok: false, error: "Conversación no encontrada" },
        { status: 404 }
      );
    }

    const { error: evErr } = await supabase.from("chat_flow_events").insert({
      empresa_id: auth.empresa_id,
      conversation_id: conversationId,
      flow_code: data.flow_code ?? null,
      node_code: data.flow_current_node ?? null,
      event_type: mode === "human" ? "takeover_human_enabled" : "takeover_bot_enabled",
      payload: {
        mode,
        by_user_id: auth.user.id,
        by_user_name: auth.nombre ?? auth.user.email ?? null,
      },
    });
    if (evErr) {
      console.error("[api/chat/flow/takeover] event insert:", evErr.message);
    }

    return NextResponse.json({
      ok: true,
      conversation_id: data.id,
      flow_code: data.flow_code,
      flow_current_node: data.flow_current_node,
      flow_status: data.flow_status,
      human_taken_over: data.human_taken_over,
    });
  } catch (e) {
    console.error("[api/chat/flow/takeover]", e);
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}
