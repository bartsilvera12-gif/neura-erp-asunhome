import { NextRequest, NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api/response";
import { repoDeleteQueue, repoFetchQueue, repoSaveQueue } from "@/lib/chat/queue-admin-repo";
import { normalizeQueueRouteId, resolveQueueAdminTenantContext } from "../_tenant-ctx";

export async function GET(request: NextRequest, ctx: { params: Promise<{ queueId: string }> }) {
  const resolved = await resolveQueueAdminTenantContext(request);
  if (!resolved) {
    return NextResponse.json(errorResponse("No autorizado"), { status: 401 });
  }
  const queueId = normalizeQueueRouteId((await ctx.params).queueId);
  if (!queueId) {
    return NextResponse.json(errorResponse("Identificador de cola inválido"), { status: 400 });
  }
  try {
    const row = await repoFetchQueue(resolved.ctx, queueId);
    return NextResponse.json(successResponse(row));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ queueId: string }> }) {
  const resolved = await resolveQueueAdminTenantContext(request);
  if (!resolved) {
    return NextResponse.json(errorResponse("No autorizado"), { status: 401 });
  }
  const queueId = normalizeQueueRouteId((await ctx.params).queueId);
  if (!queueId) {
    return NextResponse.json(errorResponse("Identificador de cola inválido"), { status: 400 });
  }
  try {
    const body = (await request.json()) as {
      nombre?: string;
      descripcion?: string | null;
      is_active?: boolean;
      channel_type?: string | null;
      distribution_strategy?: string;
      priority?: number;
      routing_config?: Record<string, unknown> | null;
    };
    await repoSaveQueue(resolved.ctx, {
      id: queueId,
      nombre: typeof body.nombre === "string" ? body.nombre : "",
      descripcion: body.descripcion,
      is_active: body.is_active !== false,
      channel_type: body.channel_type,
      distribution_strategy: typeof body.distribution_strategy === "string" ? body.distribution_strategy : "least_load",
      priority: typeof body.priority === "number" ? body.priority : 0,
      routing_config: body.routing_config === undefined ? undefined : body.routing_config ?? {},
    });
    return NextResponse.json(successResponse(true));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al guardar";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ queueId: string }> }) {
  const resolved = await resolveQueueAdminTenantContext(request);
  if (!resolved) {
    return NextResponse.json(errorResponse("No autorizado"), { status: 401 });
  }
  const queueId = normalizeQueueRouteId((await ctx.params).queueId);
  if (!queueId) {
    return NextResponse.json(errorResponse("Identificador de cola inválido"), { status: 400 });
  }
  try {
    await repoDeleteQueue(resolved.ctx, queueId);
    return NextResponse.json(successResponse(true));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al eliminar";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
