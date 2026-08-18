import { NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireMarketingOpsApiAccess } from "@/lib/marketing-ops/auth";
import { createMarketingOpsComentario, listMarketingOpsComentarios } from "@/lib/marketing-ops/service";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireMarketingOpsApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  try {
    const { id } = await params;
    const data = await listMarketingOpsComentarios({ empresaId: auth.empresaId, piezaId: id });
    return NextResponse.json(successResponse(data));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireMarketingOpsApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  try {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as { comentario?: unknown } | null;
    const data = await createMarketingOpsComentario({
      empresaId: auth.empresaId,
      usuarioId: auth.usuarioCatalogId,
      piezaId: id,
      comentario: typeof body?.comentario === "string" ? body.comentario : "",
    });
    return NextResponse.json(successResponse(data));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 400 });
  }
}
