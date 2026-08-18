import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireCampanasApiAccess } from "@/lib/campaigns/campaign-auth";

export async function GET(request: NextRequest) {
  const auth = await requireCampanasApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  const url = new URL(request.url);
  const channelId = url.searchParams.get("channel_id")?.trim();
  if (!channelId) {
    return NextResponse.json(errorResponse("channel_id es obligatorio"), { status: 400 });
  }

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const { data, error } = await sb
      .from("chat_campaign_templates")
      .select(
        "id, channel_id, provider, name, language, category, status, components_json, variable_schema_json, last_synced_at"
      )
      .eq("empresa_id", auth.empresaId)
      .eq("channel_id", channelId)
      .eq("status", "APPROVED")
      .order("name", { ascending: true });

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }

    return NextResponse.json(successResponse(data ?? []));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
