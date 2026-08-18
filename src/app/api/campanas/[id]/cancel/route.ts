import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireCampanasApiAccess } from "@/lib/campaigns/campaign-auth";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: RouteCtx) {
  const auth = await requireCampanasApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  const { id: campaignId } = await ctx.params;

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const ts = new Date().toISOString();

    const { data: campaign, error: cErr } = await sb
      .from("chat_campaigns")
      .select("status")
      .eq("id", campaignId)
      .eq("empresa_id", auth.empresaId)
      .maybeSingle();

    if (cErr || !campaign) {
      return NextResponse.json(errorResponse("Campaña no encontrada"), { status: 404 });
    }

    const st = String((campaign as { status?: string }).status ?? "");
    if (st !== "sending") {
      return NextResponse.json(errorResponse("Solo se puede cancelar una campaña en envío"), {
        status: 400,
      });
    }

    await sb
      .from("chat_campaign_recipients")
      .update({ status: "skipped", updated_at: ts })
      .eq("campaign_id", campaignId)
      .eq("empresa_id", auth.empresaId)
      .in("status", ["queued", "pending", "sending"]);

    await sb
      .from("chat_campaigns")
      .update({
        status: "cancelled",
        completed_at: ts,
        updated_at: ts,
      })
      .eq("id", campaignId)
      .eq("empresa_id", auth.empresaId);

    await sb.from("chat_campaign_events").insert({
      empresa_id: auth.empresaId,
      campaign_id: campaignId,
      recipient_id: null,
      event_type: "completed",
      event_payload_json: { kind: "cancelled" },
    });

    return NextResponse.json(successResponse({ cancelled: true }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
