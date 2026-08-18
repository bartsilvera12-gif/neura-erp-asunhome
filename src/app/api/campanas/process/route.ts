import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireCampanasApiAccess } from "@/lib/campaigns/campaign-auth";
import { runCampaignProcessOnce } from "@/lib/campaigns/campaign-job-service";
import type { SupabaseAdmin } from "@/lib/chat/types";

export async function POST(request: NextRequest) {
  const auth = await requireCampanasApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const campaignId = typeof body.campaign_id === "string" ? body.campaign_id.trim() : "";
    const batchSize =
      typeof body.batch_size === "number" && body.batch_size > 0 ? Math.floor(body.batch_size) : 25;

    if (!campaignId) {
      return NextResponse.json(errorResponse("campaign_id es obligatorio"), { status: 400 });
    }

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const result = await runCampaignProcessOnce({
      supabase: sb as unknown as SupabaseAdmin,
      empresaId: auth.empresaId,
      campaignId,
      batchSize,
    });

    return NextResponse.json(successResponse(result));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
