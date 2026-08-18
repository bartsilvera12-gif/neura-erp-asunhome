import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireCampanasApiAccess } from "@/lib/campaigns/campaign-auth";

type RouteCtx = { params: Promise<{ id: string }> };

const ACTION_TYPES = new Set(["none", "start_flow", "send_text"]);

export async function GET(request: NextRequest, ctx: RouteCtx) {
  const auth = await requireCampanasApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  const { id: campaignId } = await ctx.params;
  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const { data, error } = await sb
      .from("chat_campaign_button_actions")
      .select("*")
      .eq("campaign_id", campaignId)
      .eq("empresa_id", auth.empresaId)
      .order("button_id", { ascending: true });

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }

    return NextResponse.json(successResponse({ actions: data ?? [] }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function PUT(request: NextRequest, ctx: RouteCtx) {
  const auth = await requireCampanasApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  const { id: campaignId } = await ctx.params;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      actions?: Array<{
        button_id: string;
        button_label?: string | null;
        action_type: string;
        flow_code?: string | null;
        start_node_code?: string | null;
        text_body?: string | null;
        metadata?: Record<string, unknown>;
      }>;
    };

    const rows = Array.isArray(body.actions) ? body.actions : [];
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    const { data: camp, error: cErr } = await sb
      .from("chat_campaigns")
      .select("id, status")
      .eq("id", campaignId)
      .eq("empresa_id", auth.empresaId)
      .maybeSingle();

    if (cErr || !camp) {
      return NextResponse.json(errorResponse("Campaña no encontrada"), { status: 404 });
    }

    const st = String((camp as { status?: string }).status ?? "");
    /** Solo campañas canceladas bloquean edición: las acciones de botón son matching en inbound y deben poder corregirse tras un envío. */
    if (st === "cancelled") {
      return NextResponse.json(
        errorResponse("No se pueden editar acciones de botones en una campaña cancelada"),
        { status: 400 }
      );
    }

    for (const r of rows) {
      const at = String(r.action_type ?? "").trim();
      if (!ACTION_TYPES.has(at)) {
        return NextResponse.json(errorResponse(`action_type inválido: ${at}`), { status: 400 });
      }
      if (at === "start_flow" && !String(r.flow_code ?? "").trim()) {
        return NextResponse.json(
          errorResponse("Iniciar flujo requiere flow_code"),
          { status: 400 }
        );
      }
      if (at === "send_text" && !String(r.text_body ?? "").trim()) {
        return NextResponse.json(errorResponse("Enviar texto requiere text_body"), { status: 400 });
      }
      if (!String(r.button_id ?? "").trim()) {
        return NextResponse.json(errorResponse("Cada fila requiere button_id"), { status: 400 });
      }
    }

    const incomingIds = new Set(rows.map((r) => String(r.button_id).trim()));

    const { data: existing } = await sb
      .from("chat_campaign_button_actions")
      .select("id, button_id")
      .eq("campaign_id", campaignId)
      .eq("empresa_id", auth.empresaId);

    for (const ex of existing ?? []) {
      const bid = String((ex as { button_id?: string }).button_id ?? "").trim();
      if (bid && !incomingIds.has(bid)) {
        await sb
          .from("chat_campaign_button_actions")
          .delete()
          .eq("id", (ex as { id: string }).id)
          .eq("empresa_id", auth.empresaId);
      }
    }

    const ts = new Date().toISOString();
    for (const r of rows) {
      const button_id = String(r.button_id).trim();
      const action_type = String(r.action_type).trim() as "none" | "start_flow" | "send_text";
      const patch = {
        empresa_id: auth.empresaId,
        campaign_id: campaignId,
        button_id,
        button_label: r.button_label != null ? String(r.button_label).slice(0, 500) : null,
        action_type,
        flow_code:
          action_type === "start_flow" ? String(r.flow_code ?? "").trim() || null : null,
        start_node_code:
          action_type === "start_flow" && r.start_node_code?.trim()
            ? String(r.start_node_code).trim()
            : null,
        text_body:
          action_type === "send_text" ? String(r.text_body ?? "").trim().slice(0, 4096) : null,
        metadata:
          r.metadata && typeof r.metadata === "object" && !Array.isArray(r.metadata)
            ? r.metadata
            : {},
        updated_at: ts,
      };

      const { error: upErr } = await sb.from("chat_campaign_button_actions").upsert(patch, {
        onConflict: "campaign_id,button_id",
      });
      if (upErr) {
        return NextResponse.json(errorResponse(upErr.message), { status: 400 });
      }
    }

    await sb.from("chat_campaign_events").insert({
      empresa_id: auth.empresaId,
      campaign_id: campaignId,
      recipient_id: null,
      event_type: "button_actions_saved",
      event_payload_json: { count: rows.length },
    });

    const { data: finalRows } = await sb
      .from("chat_campaign_button_actions")
      .select("*")
      .eq("campaign_id", campaignId)
      .eq("empresa_id", auth.empresaId)
      .order("button_id", { ascending: true });

    return NextResponse.json(successResponse({ actions: finalRows ?? [] }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
