import { NextRequest, NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api/response";
import { repoRemoveQueueAgent, repoUpdateQueueAgent } from "@/lib/chat/queue-admin-repo";
import { normalizeQueueRouteId, resolveQueueAdminTenantContext } from "../../../_tenant-ctx";

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ queueId: string; agentId: string }> }) {
  const resolved = await resolveQueueAdminTenantContext(request);
  if (!resolved) {
    return NextResponse.json(errorResponse("No autorizado"), { status: 401 });
  }
  const p = await ctx.params;
  const agentId = normalizeQueueRouteId(p.agentId);
  if (!agentId) {
    return NextResponse.json(errorResponse("Identificador de agente inválido"), { status: 400 });
  }
  try {
    const body = (await request.json()) as {
      max_conversations?: number;
      is_online?: boolean;
      is_active?: boolean;
      receives_new_chats?: boolean;
      priority_in_queue?: number;
    };
    await repoUpdateQueueAgent(resolved.ctx, {
      id: agentId,
      max_conversations: typeof body.max_conversations === "number" ? body.max_conversations : 5,
      is_online: body.is_online,
      is_active: body.is_active !== false,
      receives_new_chats: body.receives_new_chats !== false,
      priority_in_queue: typeof body.priority_in_queue === "number" ? body.priority_in_queue : 0,
    });
    return NextResponse.json(successResponse(true));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al actualizar agente";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ queueId: string; agentId: string }> }) {
  const resolved = await resolveQueueAdminTenantContext(request);
  if (!resolved) {
    return NextResponse.json(errorResponse("No autorizado"), { status: 401 });
  }
  const agentId = normalizeQueueRouteId((await ctx.params).agentId);
  if (!agentId) {
    return NextResponse.json(errorResponse("Identificador de agente inválido"), { status: 400 });
  }
  try {
    await repoRemoveQueueAgent(resolved.ctx, agentId);
    return NextResponse.json(successResponse(true));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al quitar agente";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
