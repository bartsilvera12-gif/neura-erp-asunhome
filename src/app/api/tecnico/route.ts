/**
 * /api/tecnico — módulo "En el técnico" (interno dañado de fábrica + cliente).
 * GET   ?origen=&estado=&q=&activos=1
 * POST  { origen, producto_id?, serie_id?, cliente_nombre?, falla_reportada?, ... }
 * PATCH { id, estado?, diagnostico?, tecnico_nombre?, reintegrar_stock? }
 */
import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  listTecnico, crearTecnico, actualizarTecnico,
  type TecnicoOrigen, type TecnicoEstado,
} from "@/lib/inventario/server/tecnico-pg";

async function ctxOf(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return null;
  const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
  return {
    empresaId: ctx.auth.empresa_id, schema,
    usuario: { id: ctx.auth.usuarioCatalogId ?? null, nombre: ctx.auth.nombre ?? null },
  };
}

export async function GET(request: NextRequest) {
  try {
    const c = await ctxOf(request);
    if (!c) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const sp = new URL(request.url).searchParams;
    const filas = await listTecnico(c.schema, c.empresaId, {
      origen: (sp.get("origen") as TecnicoOrigen) ?? undefined,
      estado: (sp.get("estado") as TecnicoEstado) ?? undefined,
      q: sp.get("q") ?? undefined,
      activos: sp.get("activos") === "1",
    });
    return NextResponse.json(successResponse({ filas }));
  } catch (err) {
    console.error("[/api/tecnico GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo leer el listado del técnico."), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const c = await ctxOf(request);
    if (!c) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const origen: TecnicoOrigen = b.origen === "interno" ? "interno" : "cliente";
    if (origen === "interno" && !b.producto_id) {
      return NextResponse.json(errorResponse("Para un producto interno hay que elegir el producto."), { status: 400 });
    }
    if (origen === "cliente" && !(b.cliente_nombre || b.equipo_descripcion)) {
      return NextResponse.json(errorResponse("Indicá el cliente o el equipo a reparar."), { status: 400 });
    }
    const id = await crearTecnico(c.schema, c.empresaId, {
      origen,
      producto_id: (b.producto_id as string) || null,
      serie_id: (b.serie_id as string) || null,
      numero_serie: (b.numero_serie as string) || null,
      cliente_id: (b.cliente_id as string) || null,
      cliente_nombre: (b.cliente_nombre as string) || null,
      equipo_descripcion: (b.equipo_descripcion as string) || null,
      falla_reportada: (b.falla_reportada as string) || null,
    }, c.usuario);
    return NextResponse.json(successResponse({ id }));
  } catch (err) {
    console.error("[/api/tecnico POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo crear la orden."), { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const c = await ctxOf(request);
    if (!c) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = typeof b.id === "string" ? b.id : "";
    if (!id) return NextResponse.json(errorResponse("Falta el id."), { status: 400 });
    const ok = await actualizarTecnico(c.schema, c.empresaId, id, {
      estado: b.estado as TecnicoEstado | undefined,
      diagnostico: b.diagnostico === undefined ? undefined : (b.diagnostico as string | null),
      tecnico_nombre: b.tecnico_nombre === undefined ? undefined : (b.tecnico_nombre as string | null),
      reintegrarStock: b.reintegrar_stock === true,
    }, c.usuario);
    if (!ok) return NextResponse.json(errorResponse("No se pudo actualizar."), { status: 404 });
    return NextResponse.json(successResponse({ id }));
  } catch (err) {
    console.error("[/api/tecnico PATCH]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo actualizar la orden."), { status: 500 });
  }
}
