import { NextRequest, NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api/response";
import { repoCreateQueueDraft, repoListQueues } from "@/lib/chat/queue-admin-repo";
import { resolveQueueAdminTenantContext } from "./_tenant-ctx";

/**
 * Colas omnicanal autenticadas con el mismo JWT Bearer que el resto de `/api/*`
 * (`fetchWithSupabaseSession`). Evita depender solo de cookies en Server Actions.
 */
export async function GET(request: NextRequest) {
  const resolved = await resolveQueueAdminTenantContext(request);
  if (!resolved) {
    return NextResponse.json(errorResponse("No autorizado"), { status: 401 });
  }
  try {
    const rows = await repoListQueues(resolved.ctx);
    return NextResponse.json(successResponse(rows));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al listar colas";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const resolved = await resolveQueueAdminTenantContext(request);
  if (!resolved) {
    return NextResponse.json(errorResponse("No autorizado"), { status: 401 });
  }
  try {
    const id = await repoCreateQueueDraft(resolved.ctx);
    return NextResponse.json(successResponse({ id: String(id) }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al crear cola";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
