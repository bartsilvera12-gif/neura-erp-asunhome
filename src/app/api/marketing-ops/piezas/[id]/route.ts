import { NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireMarketingOpsApiAccess } from "@/lib/marketing-ops/auth";
import { getMarketingOpsPieza, updateMarketingOpsPieza } from "@/lib/marketing-ops/service";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireMarketingOpsApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  try {
    const { id } = await params;
    const data = await getMarketingOpsPieza(auth.empresaId, id);
    return NextResponse.json(successResponse(data));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: msg.includes("no encontrada") ? 404 : 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireMarketingOpsApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  try {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json(errorResponse("Body inválido"), { status: 400 });
    }
    const data = await updateMarketingOpsPieza({
      empresaId: auth.empresaId,
      usuarioId: auth.usuarioCatalogId,
      piezaId: id,
      body,
    });
    return NextResponse.json(successResponse(data));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 400 });
  }
}
