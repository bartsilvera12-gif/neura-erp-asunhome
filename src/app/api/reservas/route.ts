/**
 * GET  /api/reservas — lista de reservas (mercadería en guarda).
 * POST /api/reservas — crea una reserva: saca la mercadería del stock.
 */
import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { listReservas, crearReserva, type ReservaItemInput } from "@/lib/reservas/server/reservas-pg";

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const reservas = await listReservas(schema, ctx.auth.empresa_id);
    return NextResponse.json(successResponse({ reservas }));
  } catch (err) {
    console.error("[/api/reservas GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las reservas."), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const rawItems = Array.isArray(b.items) ? (b.items as Record<string, unknown>[]) : [];
    const items: ReservaItemInput[] = [];
    for (const it of rawItems) {
      if (!it.producto_id || !(Number(it.cantidad) > 0) || !(Number(it.precio_unitario) >= 0)) continue;
      items.push({
        producto_id: String(it.producto_id),
        producto_nombre: String(it.producto_nombre ?? ""),
        sku: it.sku != null ? String(it.sku) : null,
        cantidad: Number(it.cantidad),
        precio_unitario: Number(it.precio_unitario),
        tipo_iva: it.tipo_iva != null ? String(it.tipo_iva) : "10%",
      });
    }
    if (items.length === 0) return NextResponse.json(errorResponse("La reserva debe tener al menos un producto válido."), { status: 400 });

    const out = await crearReserva(
      schema, ctx.auth.empresa_id,
      {
        cliente_id: b.cliente_id != null && String(b.cliente_id).trim() ? String(b.cliente_id) : null,
        cliente_nombre: b.cliente_nombre != null ? String(b.cliente_nombre).slice(0, 200) : null,
        observaciones: b.observaciones != null ? String(b.observaciones).slice(0, 2000) : null,
        items,
      },
      { id: ctx.auth.usuarioCatalogId ?? null, nombre: ctx.auth.nombre ?? ctx.auth.user?.email ?? null }
    );
    return NextResponse.json(successResponse(out));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo crear la reserva.";
    console.error("[/api/reservas POST]", msg);
    return NextResponse.json(errorResponse(msg), { status: /al menos un producto/i.test(msg) ? 400 : 500 });
  }
}
