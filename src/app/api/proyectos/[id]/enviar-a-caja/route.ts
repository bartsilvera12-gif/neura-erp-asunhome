import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import { estaFacturado, estaPendienteCaja, marcarEnviadoACaja } from "@/lib/caja/facturacion";

/**
 * POST /api/proyectos/[id]/enviar-a-caja
 *
 * Marca un pedido como pendiente de facturación en Caja. NO crea venta, NO descuenta stock,
 * NO genera movimientos de inventario. Solo actualiza `proyectos.metadata`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  const { id } = await params;
  const pid = id?.trim() ?? "";
  if (!pid) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    const { data: proyecto, error: e1 } = await sb
      .from("proyectos")
      .select("id, metadata")
      .eq("empresa_id", auth.empresaId)
      .eq("id", pid)
      .maybeSingle();
    if (e1) return NextResponse.json(errorResponse(e1.message), { status: 400 });
    if (!proyecto) return NextResponse.json(errorResponse("Pedido no encontrado"), { status: 404 });

    const metadata = (proyecto as { metadata?: unknown }).metadata;
    if (estaFacturado(metadata)) {
      return NextResponse.json(errorResponse("Este pedido ya fue facturado."), { status: 409 });
    }
    if (estaPendienteCaja(metadata)) {
      return NextResponse.json(errorResponse("Este pedido ya está pendiente en Caja."), { status: 409 });
    }

    const now = new Date().toISOString();
    const nuevaMeta = marcarEnviadoACaja(metadata, now);

    const { error: e2 } = await sb
      .from("proyectos")
      .update({
        metadata: nuevaMeta,
        last_activity_at: now,
        ultimo_movimiento_at: now,
        updated_by: auth.usuarioCatalogId,
      })
      .eq("empresa_id", auth.empresaId)
      .eq("id", pid);
    if (e2) return NextResponse.json(errorResponse(e2.message), { status: 400 });

    return NextResponse.json(successResponse({ id: pid, facturacion_estado: "pendiente_caja", enviado_a_caja_at: now }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
