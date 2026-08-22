/**
 * /api/averiados — productos devueltos por el cliente (no salen de stock).
 * GET   ?estado=&q=&activos=1
 * POST  { producto_id, ... }        alta manual o desde devolución
 * PATCH { id, estado?, observaciones?, recuperado? }
 */
import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  listAveriados, crearAveriado, actualizarAveriado,
  type AveriadoEstado,
} from "@/lib/inventario/server/averiados-pg";

async function ctxOf(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return null;
  const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
  return { empresaId: ctx.auth.empresa_id, userId: ctx.auth.usuarioCatalogId ?? null, schema };
}

export async function GET(request: NextRequest) {
  try {
    const c = await ctxOf(request);
    if (!c) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const sp = new URL(request.url).searchParams;
    const filas = await listAveriados(c.schema, c.empresaId, {
      estado: (sp.get("estado") as AveriadoEstado) ?? undefined,
      q: sp.get("q") ?? undefined,
      soloActivos: sp.get("activos") === "1",
    });
    return NextResponse.json(successResponse({ filas }));
  } catch (err) {
    console.error("[/api/averiados GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron leer los averiados."), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const c = await ctxOf(request);
    if (!c) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const productoId = typeof b.producto_id === "string" ? b.producto_id : "";
    if (!productoId) return NextResponse.json(errorResponse("Falta el producto."), { status: 400 });
    const id = await crearAveriado(c.schema, c.empresaId, {
      producto_id: productoId,
      serie_id: (b.serie_id as string) || null,
      numero_serie: (b.numero_serie as string) || null,
      proveedor_id: (b.proveedor_id as string) || null,
      cantidad: b.cantidad != null ? Math.max(1, Number(b.cantidad) || 1) : 1,
      descripcion: (b.descripcion as string) || null,
      observaciones: (b.observaciones as string) || null,
    }, c.userId);
    return NextResponse.json(successResponse({ id }));
  } catch (err) {
    console.error("[/api/averiados POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo registrar el averiado."), { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const c = await ctxOf(request);
    if (!c) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = typeof b.id === "string" ? b.id : "";
    if (!id) return NextResponse.json(errorResponse("Falta el id."), { status: 400 });
    const ok = await actualizarAveriado(c.schema, c.empresaId, id, {
      estado: b.estado as AveriadoEstado | undefined,
      observaciones: b.observaciones === undefined ? undefined : (b.observaciones as string | null),
      recuperado: b.recuperado === undefined ? undefined : b.recuperado === true,
    }, c.userId);
    if (!ok) return NextResponse.json(errorResponse("No se pudo actualizar."), { status: 404 });
    return NextResponse.json(successResponse({ id }));
  } catch (err) {
    console.error("[/api/averiados PATCH]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo actualizar el averiado."), { status: 500 });
  }
}
