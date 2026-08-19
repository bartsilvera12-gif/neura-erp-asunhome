import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import { asMetadataObject } from "@/lib/caja/facturacion";

/**
 * GET /api/caja/pedidos-pendientes
 *
 * Lista los pedidos (proyectos) enviados a Caja y aún no facturados
 * (`metadata.facturacion_estado = 'pendiente_caja'`). Solo lectura.
 */
export async function GET(request: Request) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const { data, error } = await sb
      .from("proyectos")
      .select("id, titulo, cliente_id, monto_vendido, fecha_ingreso, created_at, brief_data, metadata")
      .eq("empresa_id", auth.empresaId)
      .eq("archivado", false)
      .eq("metadata->>facturacion_estado", "pendiente_caja")
      .order("last_activity_at", { ascending: false })
      .limit(200);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    const pedidos = ((data ?? []) as Record<string, unknown>[]).map((p) => {
      const brief = asMetadataObject(p.brief_data);
      const meta = asMetadataObject(p.metadata);
      const itemsRaw = Array.isArray(brief.items) ? (brief.items as Record<string, unknown>[]) : [];
      return {
        id: String(p.id),
        titulo: typeof p.titulo === "string" ? p.titulo : "",
        cliente_nombre:
          (typeof brief.cliente_nombre === "string" && brief.cliente_nombre) ||
          (typeof brief.cliente_telefono === "string" && brief.cliente_telefono) ||
          null,
        cliente_id: p.cliente_id ? String(p.cliente_id) : null,
        total_estimado: Number(p.monto_vendido) || 0,
        origen: typeof meta.source === "string" ? meta.source : "manual",
        enviado_a_caja_at: typeof meta.enviado_a_caja_at === "string" ? meta.enviado_a_caja_at : null,
        fecha: (typeof p.fecha_ingreso === "string" && p.fecha_ingreso) || (p.created_at as string) || null,
        items: itemsRaw.map((it) => ({
          producto_id: it.producto_id ? String(it.producto_id) : null,
          producto_nombre: typeof it.producto_nombre === "string" ? it.producto_nombre : "—",
          sku: typeof it.sku === "string" ? it.sku : null,
          cantidad: Number(it.cantidad) || 0,
          precio_venta: Number(it.precio_venta) || 0,
        })),
      };
    });

    return NextResponse.json(successResponse({ pedidos }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
