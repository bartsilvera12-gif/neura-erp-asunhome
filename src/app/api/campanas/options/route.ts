import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireCampanasApiAccess } from "@/lib/campaigns/campaign-auth";
import { isOutboundWhatsappLikeChannel } from "@/lib/chat/outbound-send-dispatch";

export async function GET(request: NextRequest) {
  const auth = await requireCampanasApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    const [{ data: channels, error: chErr }, { data: queues, error: qErr }] = await Promise.all([
      sb
        .from("chat_channels")
        .select("id, nombre, provider, type, activo")
        .eq("empresa_id", auth.empresaId)
        .eq("activo", true),
      sb
        .from("chat_queues")
        .select("id, nombre, is_active, priority")
        .eq("empresa_id", auth.empresaId)
        .eq("is_active", true)
        .order("priority", { ascending: false }),
    ]);

    if (chErr) {
      return NextResponse.json(errorResponse(chErr.message), { status: 400 });
    }
    if (qErr) {
      return NextResponse.json(errorResponse(qErr.message), { status: 400 });
    }

    const waChannels = (channels ?? []).filter((c) =>
      isOutboundWhatsappLikeChannel(
        c as { type?: string | null; provider?: string | null; activo?: boolean | null }
      )
    );

    return NextResponse.json(successResponse({ channels: waChannels, queues: queues ?? [] }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
