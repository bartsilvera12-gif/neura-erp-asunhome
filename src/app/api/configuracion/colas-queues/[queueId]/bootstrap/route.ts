import { NextRequest, NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api/response";
import { repoLoadQueueEditorBootstrap } from "@/lib/chat/queue-admin-repo";
import { normalizeQueueRouteId, resolveQueueAdminTenantContext } from "../../_tenant-ctx";

export async function GET(request: NextRequest, ctx: { params: Promise<{ queueId: string }> }) {
  const resolved = await resolveQueueAdminTenantContext(request);
  if (!resolved) {
    return NextResponse.json(errorResponse("No autorizado"), { status: 401 });
  }
  const params = await ctx.params;
  const queueId = normalizeQueueRouteId(params.queueId);
  if (!queueId) {
    return NextResponse.json(errorResponse("Identificador de cola inválido"), { status: 400 });
  }
  try {
    const data = await repoLoadQueueEditorBootstrap(resolved.ctx, queueId);
    if (!data.queue) {
      return NextResponse.json(errorResponse("Cola no encontrada o sin acceso para tu empresa."), { status: 404 });
    }
    return NextResponse.json(successResponse(data));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al cargar cola";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
