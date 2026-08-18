import { NextRequest, NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api/response";
import { repoAddAgentToQueue } from "@/lib/chat/queue-admin-repo";
import { normalizeQueueRouteId, resolveQueueAdminTenantContext } from "../../_tenant-ctx";

export async function POST(request: NextRequest, ctx: { params: Promise<{ queueId: string }> }) {
  const resolved = await resolveQueueAdminTenantContext(request);
  if (!resolved) {
    return NextResponse.json(errorResponse("No autorizado"), { status: 401 });
  }
  const queueId = normalizeQueueRouteId((await ctx.params).queueId);
  if (!queueId) {
    return NextResponse.json(errorResponse("Identificador de cola inválido"), { status: 400 });
  }
  try {
    const body = (await request.json()) as { usuario_id?: string };
    const uid = (body.usuario_id ?? "").trim();
    if (!uid) {
      return NextResponse.json(errorResponse("usuario_id requerido"), { status: 400 });
    }
    await repoAddAgentToQueue(resolved.ctx, { queue_id: queueId, usuario_id: uid });
    return NextResponse.json(successResponse(true));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al añadir agente";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
