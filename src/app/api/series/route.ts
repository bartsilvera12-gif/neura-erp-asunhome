/**
 * /api/series — números de serie por unidad.
 *
 * GET    ?producto=<id>&estado=<e>&q=<txt>&disponibles=1  → listar / consultar
 * POST   { producto_id, series: [...] }                    → alta en lote (entrada)
 * PATCH  { id, ...patch }                                   → cambiar estado/datos
 * DELETE { id }                                             → borrar (solo en_stock)
 */
import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  listSeries, listSeriesDisponibles, insertSeries, actualizarSerie, deleteSerie,
  type SerieEstado, type SerieInput,
} from "@/lib/inventario/server/series-pg";

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
    const productoId = sp.get("producto") ?? undefined;

    if (sp.get("disponibles") === "1" && productoId) {
      const filas = await listSeriesDisponibles(c.schema, c.empresaId, productoId);
      return NextResponse.json(successResponse({ filas }));
    }
    const filas = await listSeries(c.schema, c.empresaId, {
      productoId,
      estado: (sp.get("estado") as SerieEstado) ?? undefined,
      q: sp.get("q") ?? undefined,
    });
    return NextResponse.json(successResponse({ filas }));
  } catch (err) {
    console.error("[/api/series GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron leer las series."), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const c = await ctxOf(request);
    if (!c) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const productoId = typeof b.producto_id === "string" ? b.producto_id : "";
    if (!productoId) return NextResponse.json(errorResponse("Falta el producto."), { status: 400 });
    const raw = Array.isArray(b.series) ? b.series : [];
    const toInput = (x: unknown): SerieInput | null => {
      if (typeof x === "string") return { numero_serie: x };
      if (!x || typeof x !== "object") return null;
      const o = x as Record<string, unknown>;
      if (typeof o.numero_serie !== "string") return null;
      const s = (v: unknown) => (v == null || v === "" ? null : String(v));
      const n = (v: unknown) => (v == null || v === "" ? null : Number(v));
      return {
        numero_serie: o.numero_serie,
        proveedor_id: s(o.proveedor_id),
        compra_id: s(o.compra_id),
        costo_unitario: n(o.costo_unitario),
        ubicacion_id: s(o.ubicacion_id),
        observaciones: s(o.observaciones),
        garantia_hasta: s(o.garantia_hasta),
      };
    };
    const series: SerieInput[] = raw
      .map(toInput)
      .filter((x): x is SerieInput => !!x && typeof x.numero_serie === "string" && x.numero_serie.trim() !== "");
    if (series.length === 0) return NextResponse.json(errorResponse("No hay series para cargar."), { status: 400 });

    const r = await insertSeries(c.schema, c.empresaId, productoId, series, c.userId);
    return NextResponse.json(successResponse(r));
  } catch (err) {
    console.error("[/api/series POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las series."), { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const c = await ctxOf(request);
    if (!c) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = typeof b.id === "string" ? b.id : "";
    if (!id) return NextResponse.json(errorResponse("Falta el id."), { status: 400 });
    const fila = await actualizarSerie(c.schema, c.empresaId, id, {
      estado: b.estado as SerieEstado | undefined,
      ubicacion_id: b.ubicacion_id === undefined ? undefined : (b.ubicacion_id as string | null),
      observaciones: b.observaciones === undefined ? undefined : (b.observaciones as string | null),
      updated_by: c.userId,
    });
    if (!fila) return NextResponse.json(errorResponse("Serie no encontrada."), { status: 404 });
    return NextResponse.json(successResponse({ fila }));
  } catch (err) {
    console.error("[/api/series PATCH]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo actualizar la serie."), { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const c = await ctxOf(request);
    if (!c) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = typeof b.id === "string" ? b.id : "";
    if (!id) return NextResponse.json(errorResponse("Falta el id."), { status: 400 });
    const ok = await deleteSerie(c.schema, c.empresaId, id);
    if (!ok) return NextResponse.json(errorResponse("No se puede borrar: la serie ya no está en stock."), { status: 409 });
    return NextResponse.json(successResponse({ id }));
  } catch (err) {
    console.error("[/api/series DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo borrar la serie."), { status: 500 });
  }
}
