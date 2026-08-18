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

  const { id: campaignId } = await ctx.params;
  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status")?.trim();
  const cursor = Number(url.searchParams.get("cursor_row") ?? "0") || 0;
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? "50") || 50));

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    let q = sb
      .from("chat_campaign_recipients")
      .select(
        "id, row_number, phone_raw, phone_e164, status, validation_error, provider_message_id, mapped_variables_json, row_payload_json, sent_at, failed_at, first_reply_at, created_at"
      )
      .eq("campaign_id", campaignId)
      .eq("empresa_id", auth.empresaId);

    if (statusFilter) {
      q = q.eq("status", statusFilter);
    }

    const { data, error } = await q
      .gt("row_number", cursor)
      .order("row_number", { ascending: true })
      .limit(limit);

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }

    return NextResponse.json(successResponse({ recipients: data ?? [], next_cursor_row: null }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
