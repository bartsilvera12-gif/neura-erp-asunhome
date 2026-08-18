import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireCampanasApiAccess } from "@/lib/campaigns/campaign-auth";
import { syncCampaignTemplatesForChannel } from "@/lib/campaigns/campaign-template-service";
import type { SupabaseAdmin } from "@/lib/chat/types";

export async function POST(request: NextRequest) {
  const auth = await requireCampanasApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const channelId = typeof body.channel_id === "string" ? body.channel_id.trim() : "";
    if (!channelId) {
      return NextResponse.json(errorResponse("channel_id es obligatorio"), { status: 400 });
    }

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const res = await syncCampaignTemplatesForChannel({
      supabase: sb as unknown as SupabaseAdmin,
      empresaId: auth.empresaId,
      channelId,
    });

    if (res.error) {
      return NextResponse.json(errorResponse(res.error), { status: 400 });
    }

    return NextResponse.json(successResponse({ inserted: res.inserted, fetched: res.fetched }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
