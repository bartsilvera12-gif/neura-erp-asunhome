import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { applyTokenSearch } from "@/lib/productos/token-search";

/**
 * GET /api/inventario/movimientos
 *
 * Paginado + filtros server-side (compat Hostinger sin pool PG, via PostgREST).
 *
 * Query params:
 *   - q            : texto a buscar en producto_nombre/producto_sku (ILIKE)
 *   - tipo         : ENTRADA | SALIDA | AJUSTE
 *   - origen       : compra | venta | ajuste_manual | inventario_inicial
 *   - fecha_desde  : YYYY-MM-DD (incluye)
 *   - fecha_hasta  : YYYY-MM-DD (incluye, hasta fin de dia)
 *   - limit        : default 25, max 200
 *   - offset       : default 0
 *
 * Response: { movimientos: Movimiento[], total: number }
 *
 * El total usa count: "planned" (estimado via pg_stats) — mismo trade-off que
 * productos: precision suficiente para paginacion y ~10x mas rapido que
 * "exact" cuando hay miles de filas. Si la tabla esta vacia o muy chica,
 * planned puede devolver 0; lo corregimos con un fallback.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;

    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const tipo = (url.searchParams.get("tipo") ?? "").trim();
    const origen = (url.searchParams.get("origen") ?? "").trim();
    const fechaDesde = (url.searchParams.get("fecha_desde") ?? "").trim();
    const fechaHasta = (url.searchParams.get("fecha_hasta") ?? "").trim();
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") ?? 25) || 25));
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);

    let query = ctx.supabase
      .from("movimientos_inventario")
      .select(
        "id, empresa_id, producto_id, producto_nombre, producto_sku, tipo, cantidad, costo_unitario, origen, referencia, fecha, created_at, updated_at, created_by, usuario_nombre",
        { count: "planned" }
      )
      .eq("empresa_id", empresaId);

    if (tipo) query = query.eq("tipo", tipo);
    if (origen) query = query.eq("origen", origen);

    if (q.length > 0) {
      // Búsqueda por tokens (cada palabra en cualquier orden) sobre nombre y SKU.
      query = applyTokenSearch(query, q, ["producto_nombre", "producto_sku"]);
    }

    if (fechaDesde) {
      // gte: incluye el dia desde 00:00.
      query = query.gte("fecha", `${fechaDesde}T00:00:00`);
    }
    if (fechaHasta) {
      // lte: incluye el dia hasta 23:59:59.999.
      query = query.lte("fecha", `${fechaHasta}T23:59:59.999`);
    }

    query = query
      .order("fecha", { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw new Error(error.message);

    // Fallback: si planned devolvio 0 pero hay datos en esta pagina, hacemos
    // un count exacto barato (solo cuando hace falta). Cubre tablas pequeñas
    // que pg_stats aun no estimo.
    let total = typeof count === "number" ? count : 0;
    if (total === 0 && (data?.length ?? 0) > 0) {
      const exact = await ctx.supabase
        .from("movimientos_inventario")
        .select("id", { count: "exact", head: true })
        .eq("empresa_id", empresaId);
      total = exact.count ?? data?.length ?? 0;
    }

    return NextResponse.json(
      successResponse({ movimientos: data ?? [], total })
    );
  } catch (err) {
    console.error("[/api/inventario/movimientos GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar los movimientos."), { status: 500 });
  }
}
