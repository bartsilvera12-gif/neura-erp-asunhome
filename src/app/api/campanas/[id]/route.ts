import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireCampanasApiAccess } from "@/lib/campaigns/campaign-auth";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: RouteCtx) {
  const auth = await requireCampanasApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  const { id } = await ctx.params;
  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const { data, error } = await sb
      .from("chat_campaigns")
      .select("*")
      .eq("id", id)
      .eq("empresa_id", auth.empresaId)
      .maybeSingle();

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }
    if (!data) {
      return NextResponse.json(errorResponse("Campaña no encontrada"), { status: 404 });
    }

    const { data: events } = await sb
      .from("chat_campaign_events")
      .select("id, event_type, event_payload_json, created_at, recipient_id")
      .eq("campaign_id", id)
      .eq("empresa_id", auth.empresaId)
      .order("created_at", { ascending: false })
      .limit(100);

    return NextResponse.json(successResponse({ campaign: data, events: events ?? [] }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function PATCH(request: NextRequest, ctx: RouteCtx) {
  const auth = await requireCampanasApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  const { id } = await ctx.params;
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    const { data: cur, error: curErr } = await sb
      .from("chat_campaigns")
      .select("status")
      .eq("id", id)
      .eq("empresa_id", auth.empresaId)
      .maybeSingle();

    if (curErr || !cur) {
      return NextResponse.json(errorResponse("Campaña no encontrada"), { status: 404 });
    }

    const st = String((cur as { status?: string }).status ?? "");
    if (st === "sending" || st === "completed" || st === "cancelled") {
      return NextResponse.json(errorResponse("No se puede editar esta campaña en el estado actual"), {
        status: 400,
      });
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (typeof body.name === "string") patch.name = body.name.trim();
    if (typeof body.channel_id === "string") patch.channel_id = body.channel_id.trim();
    if (body.queue_id === null) patch.queue_id = null;
    if (typeof body.queue_id === "string") patch.queue_id = body.queue_id.trim();
    if (typeof body.provider === "string") patch.provider = body.provider.trim().toLowerCase();
    if (typeof body.template_id === "string") patch.template_id = body.template_id.trim();
    if (body.template_id === null) patch.template_id = null;
    if (typeof body.template_name === "string") patch.template_name = body.template_name.trim();
    if (typeof body.template_language === "string") patch.template_language = body.template_language.trim();
    if (typeof body.template_category === "string") patch.template_category = body.template_category.trim();
    if (body.template_components_json !== undefined) patch.template_components_json = body.template_components_json;
    if (body.variable_mapping_json !== undefined) patch.variable_mapping_json = body.variable_mapping_json;

    const { data, error } = await sb
      .from("chat_campaigns")
      .update(patch)
      .eq("id", id)
      .eq("empresa_id", auth.empresaId)
      .select("*")
      .maybeSingle();

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }

    return NextResponse.json(successResponse(data));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
