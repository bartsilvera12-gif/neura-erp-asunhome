import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getRotacionAbc } from "@/lib/reportes/server/rotacion-abc-pg";
import { asuncionRangeBoundsUtc } from "@/lib/fechas/asuncion-bounds";
import { productoMatchesQuery } from "@/lib/productos/token-search";
import type { RangoABC } from "@/lib/reportes/abc";

const TZ = "America/Asuncion";
const PAGE_SIZES = [25, 50, 100, 200];

/** Bordes UTC de "los últimos N meses" (Asunción), + etiquetas YYYY-MM-DD. */
function ultimosMesesBounds(meses: number) {
  const hoy = new Date();
  const inicio = new Date(hoy);
  inicio.setMonth(inicio.getMonth() - meses);
  const hasta = hoy.toLocaleDateString("en-CA", { timeZone: TZ });
  const desde = inicio.toLocaleDateString("en-CA", { timeZone: TZ });
  const { start, end } = asuncionRangeBoundsUtc(desde, hasta);
  return { start, end, desde, hasta };
}

/**
 * GET /api/reportes/rotacion-abc?meses=1|2|3
 *   - &mapa=1                          → solo { producto_id, rango } de A/B (mínimo, para el listado de productos)
 *   - &page=&pageSize=&rango=&q=       → paginado + filtros server-side (default pageSize 25)
 *
 * La clasificación ABC se calcula SIEMPRE sobre el universo completo (para que
 * el rango y los totales sean correctos); solo se paginan/filtran las filas que
 * se devuelven, evitando mandar 17k filas al navegador.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);

    const sp = new URL(request.url).searchParams;
    const rawMeses = parseInt(sp.get("meses") ?? "3", 10);
    const meses = [1, 2, 3].includes(rawMeses) ? rawMeses : 3;
    const b = ultimosMesesBounds(meses);

    const full = await getRotacionAbc(schema, ctx.auth.empresa_id, { ...b, meses });

    // Mapa mínimo para el listado de productos: solo A/B (el resto es C por defecto).
    if (sp.get("mapa") === "1") {
      const mapa = full.productos
        .filter((p) => p.rango !== "C")
        .map((p) => ({ producto_id: p.producto_id, rango: p.rango }));
      return NextResponse.json(successResponse({ meses, mapa }));
    }

    // Filtros + paginado server-side.
    const rango = sp.get("rango") as RangoABC | null;
    const q = (sp.get("q") ?? "").trim();
    const rawSize = parseInt(sp.get("pageSize") ?? "25", 10);
    const pageSize = PAGE_SIZES.includes(rawSize) ? rawSize : 25;
    const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);

    let filtrados = full.productos;
    if (rango === "A" || rango === "B" || rango === "C") {
      filtrados = filtrados.filter((p) => p.rango === rango);
    }
    if (q) {
      filtrados = filtrados.filter((p) => productoMatchesQuery(q, p.nombre, p.sku));
    }
    const total = filtrados.length;
    const start = (page - 1) * pageSize;
    const productos = filtrados.slice(start, start + pageSize);

    return NextResponse.json(
      successResponse({
        desde: full.desde,
        hasta: full.hasta,
        meses,
        totales: full.totales,
        page,
        pageSize,
        total,
        productos,
      })
    );
  } catch (err) {
    console.error("[/api/reportes/rotacion-abc]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo calcular la rotación de productos."), { status: 500 });
  }
}
