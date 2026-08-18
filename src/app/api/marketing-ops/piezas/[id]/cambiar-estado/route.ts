import { NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireMarketingOpsApiAccess } from "@/lib/marketing-ops/auth";
import { changeMarketingOpsEstado } from "@/lib/marketing-ops/service";
import type { MarketingOpsEstadoCampo } from "@/lib/marketing-ops/types";

const CAMPOS = new Set(["estado_produccion", "estado_cliente", "estado_publicacion"]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireMarketingOpsApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  try {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const campo = typeof body?.campo === "string" ? body.campo : "";
    const estado = typeof body?.estado === "string" ? body.estado : "";
    if (!CAMPOS.has(campo) || !estado) {
      return NextResponse.json(errorResponse("campo y estado son obligatorios"), { status: 400 });
    }
    const data = await changeMarketingOpsEstado({
      empresaId: auth.empresaId,
      usuarioId: auth.usuarioCatalogId,
      piezaId: id,
      campo: campo as MarketingOpsEstadoCampo,
      estado,
    });
    return NextResponse.json(successResponse(data));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 400 });
  }
}
