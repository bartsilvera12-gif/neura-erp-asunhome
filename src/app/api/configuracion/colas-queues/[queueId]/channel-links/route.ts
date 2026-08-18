import { NextRequest, NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api/response";
import { repoSetQueueChannelLinks } from "@/lib/chat/queue-admin-repo";
import { normalizeQueueRouteId, resolveQueueAdminTenantContext } from "../../_tenant-ctx";

export async function PUT(request: NextRequest, ctx: { params: Promise<{ queueId: string }> }) {
  const resolved = await resolveQueueAdminTenantContext(request);
  if (!resolved) {
    return NextResponse.json(errorResponse("No autorizado"), { status: 401 });
  }
  const queueId = normalizeQueueRouteId((await ctx.params).queueId);
  if (!queueId) {
    return NextResponse.json(errorResponse("Identificador de cola inválido"), { status: 400 });
  }
  try {
    const body = (await request.json()) as { channel_ids?: string[] };
    const ids = Array.isArray(body.channel_ids) ? body.channel_ids : [];
    await repoSetQueueChannelLinks(resolved.ctx, queueId, ids);
    return NextResponse.json(successResponse(true));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al guardar canales";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
