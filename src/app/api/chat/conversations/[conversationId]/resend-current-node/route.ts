import { NextRequest, NextResponse } from "next/server";
import { getAuthWithRol } from "@/lib/middleware/auth";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { createFlowEngine } from "@/lib/chat/flow-engine-service";

const EVENT_OK = "manual_current_node_resent" as const;
const EVENT_FAIL = "manual_current_node_resend_failed" as const;

function sanitizeErrorForAudit(msg: string): string {
  const t = (msg || "").trim().slice(0, 400);
  return t
    .replace(/Bearer\s+[\w._-]+/gi, "Bearer [redacted]")
    .replace(/EAA[\w-]{20,}/g, "[redacted_token]")
    .replace(/ycyibjxplsgguuxbqtps/gi, "[redacted_ref]");
}

/**
 * POST /api/chat/conversations/:conversationId/resend-current-node
 * Reenvía el nodo de flujo actual (misma lógica que el motor) sin avanzar ni modificar puntero/datos.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ conversationId: string }> }
) {
  try {
    const auth = await getAuthWithRol(request);
    if (!auth?.empresa_id) {
      return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
    }

    const { conversationId: rawId } = await context.params;
    const conversationId = (rawId ?? "").trim();
    if (!conversationId) {
      return NextResponse.json({ ok: false, error: "Falta conversationId" }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      confirm_human_override?: boolean;
    };
    const confirmHuman = Boolean(body.confirm_human_override);

    const supabase = await getChatServiceClientForEmpresa(auth.empresa_id);

    const { data: conv, error: convErr } = await supabase
      .from("chat_conversations")
      .select(
        "id, empresa_id, flow_code, flow_current_node, flow_status, human_taken_over, active_flow_session_id"
      )
      .eq("id", conversationId)
      .maybeSingle();

    if (convErr) {
      return NextResponse.json({ ok: false, error: convErr.message }, { status: 400 });
    }
    if (!conv) {
      return NextResponse.json({ ok: false, error: "Conversación no encontrada" }, { status: 404 });
    }

    const empresaIdRow = String((conv as { empresa_id?: string }).empresa_id ?? "").trim();
    if (empresaIdRow !== auth.empresa_id) {
      return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 403 });
    }

    const flowCode = String((conv as { flow_code?: string | null }).flow_code ?? "").trim();
    const nodeCode = String((conv as { flow_current_node?: string | null }).flow_current_node ?? "").trim();

    if (!flowCode || !nodeCode) {
      return NextResponse.json(
        {
          ok: false,
          error: "Esta conversación no tiene un paso de flujo activo para reenviar.",
        },
        { status: 400 }
      );
    }

    const humanTaken = Boolean((conv as { human_taken_over?: boolean | null }).human_taken_over);
    if (humanTaken && !confirmHuman) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "La conversación está en modo humano. Confirmá si querés reenviar igualmente el mensaje del paso actual del bot.",
          needs_human_override_confirmation: true,
        },
        { status: 409 }
      );
    }

    const engine = createFlowEngine({ supabase });
    const sent = await engine.sendCurrentFlowNode({ conversationId });

    const baseAudit = {
      source: "inbox" as const,
      at: new Date().toISOString(),
      conversation_id: conversationId,
      empresa_id: auth.empresa_id,
      flow_code: flowCode,
      node_code: nodeCode,
      operator_user_id: auth.user.id,
      operator_label: (auth.nombre ?? auth.user.email ?? "").trim() || null,
    };

    if (!sent.ok) {
      const safeErr = sanitizeErrorForAudit(sent.error ?? "send_failed");
      const { error: evErr } = await supabase.from("chat_flow_events").insert({
        empresa_id: auth.empresa_id,
        conversation_id: conversationId,
        flow_code: flowCode,
        node_code: nodeCode,
        flow_session_id:
          String((conv as { active_flow_session_id?: string | null }).active_flow_session_id ?? "").trim() ||
          null,
        event_type: EVENT_FAIL,
        payload: {
          ...baseAudit,
          error_message: safeErr,
        },
      });
      if (evErr) {
        console.error("[resend-current-node] audit insert failed:", evErr.message);
      }
      return NextResponse.json(
        {
          ok: false,
          error:
            sent.error?.trim() ||
            "No se pudo reenviar el paso actual. Revisá el estado del canal o los logs.",
        },
        { status: 502 }
      );
    }

    const { error: okEvErr } = await supabase.from("chat_flow_events").insert({
      empresa_id: auth.empresa_id,
      conversation_id: conversationId,
      flow_code: flowCode,
      node_code: sent.nodeCode ?? nodeCode,
      flow_session_id:
        String((conv as { active_flow_session_id?: string | null }).active_flow_session_id ?? "").trim() ||
        null,
      event_type: EVENT_OK,
      payload: baseAudit,
    });
    if (okEvErr) {
      console.error("[resend-current-node] audit insert failed:", okEvErr.message);
    }

    return NextResponse.json({
      ok: true,
      flow_code: flowCode,
      node_code: sent.nodeCode ?? nodeCode,
    });
  } catch (e) {
    console.error("[resend-current-node]", e);
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}
