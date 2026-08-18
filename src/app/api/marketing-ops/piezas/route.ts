import { NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireMarketingOpsApiAccess } from "@/lib/marketing-ops/auth";
import { createMarketingOpsPieza, listMarketingOpsPiezas } from "@/lib/marketing-ops/service";

export async function GET(request: Request) {
  const auth = await requireMarketingOpsApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  try {
    const sp = new URL(request.url).searchParams;
    const data = await listMarketingOpsPiezas({
      empresaId: auth.empresaId,
      filters: {
        cliente_id: sp.get("cliente_id"),
        responsable_id: sp.get("responsable_id"),
        prioridad: sp.get("prioridad"),
        estado_produccion: sp.get("estado_produccion"),
        estado_cliente: sp.get("estado_cliente"),
        estado_publicacion: sp.get("estado_publicacion"),
        vencidas: sp.get("vencidas") === "true",
        desde: sp.get("desde"),
        hasta: sp.get("hasta"),
        q: sp.get("q"),
      },
    });
    return NextResponse.json(successResponse(data));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireMarketingOpsApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json(errorResponse("Body inválido"), { status: 400 });
    }
    const data = await createMarketingOpsPieza({
      empresaId: auth.empresaId,
      usuarioId: auth.usuarioCatalogId,
      body,
    });
    return NextResponse.json(successResponse(data));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 400 });
  }
}
