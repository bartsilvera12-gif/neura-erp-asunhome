import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { signProductoImagen } from "@/lib/inventario/imagen-storage";
import { applyTokenSearch } from "@/lib/productos/token-search";

interface ProductoSearchHit {
  id: string;
  nombre: string;
  sku: string;
  codigo_barras: string | null;
  codigo_barras_interno: boolean;
  precio_venta: number;
  precio_mayorista: number;
  precio_distribuidor: number | null;
  costo_promedio: number;
  stock_actual: number;
  stock_minimo: number;
  unidad_medida: string;
  metodo_valuacion: string;
  imagen_path: string | null;
  imagen_url: string | null;
  categoria_nombre: string | null;
  proveedor_nombre: string | null;
  ubicacion_nombre: string | null;
  ubicacion_tipo: string | null;
  es_vendible: boolean;
  controla_stock: boolean;
  modo_receta: string;
  // Descuento promocional (oferta)
  discount_type: "percentage" | "fixed" | null;
  discount_value: number | null;
  discount_starts_at: string | null;
  discount_ends_at: string | null;
}

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

/**
 * GET /api/productos/search?q=...&limit=30
 *
 * Búsqueda por TOKENS (palabras clave en cualquier orden) case-insensitive en
 * nombre/sku/codigo_barras vía PostgREST (compatible Hostinger sin pool PG).
 * Filtra a vendibles únicamente.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase, auth } = ctx;
    const empresaId = auth.empresa_id;

    const url = new URL(request.url);
    const qRaw = (url.searchParams.get("q") ?? "").trim();
    const q = qRaw.slice(0, 100);
    const limitParam = parseInt(url.searchParams.get("limit") ?? "", 10);
    const limit = Math.max(
      1,
      Math.min(MAX_LIMIT, Number.isFinite(limitParam) ? limitParam : DEFAULT_LIMIT)
    );

    const conDescuento = url.searchParams.get("con_descuento") === "1";
    const categoriaId = (url.searchParams.get("categoria_id") ?? "").trim() || null;

    let query = supabase
      .from("productos")
      .select(
        "id, nombre, sku, codigo_barras, codigo_barras_interno, " +
          "precio_venta, precio_mayorista, precio_distribuidor, costo_promedio, stock_actual, stock_minimo, " +
          "unidad_medida, metodo_valuacion, imagen_path, imagen_url, " +
          "categoria_principal_id, proveedor_principal_id, ubicacion_principal_id, " +
          "es_vendible, controla_stock, modo_receta, activo, " +
          "discount_type, discount_value, discount_starts_at, discount_ends_at"
      )
      .eq("empresa_id", empresaId)
      .eq("activo", true)
      .eq("es_vendible", true);

    // Filtro opcional para el picker de 'Ofertas del home': solo productos
    // con descuento promocional configurado (tipo + valor > 0). No exige
    // que la ventana temporal este activa AHORA — alcanza con que el
    // descuento exista; la ventana se evalua en render.
    if (conDescuento) {
      query = query.not("discount_type", "is", null).gt("discount_value", 0);
    }

    if (q.length > 0) {
      // Cada palabra debe aparecer en nombre/sku/codigo_barras (AND entre
      // tokens, OR entre columnas) → matching orden-independiente.
      query = applyTokenSearch(query, q, ["nombre", "sku", "codigo_barras"]);
    }

    if (categoriaId) {
      query = query.eq("categoria_principal_id", categoriaId);
    }

    query = query.order("nombre").limit(limit);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    type Row = Record<string, unknown>;
    const rows = ((data ?? []) as unknown as Row[]).map((r) => ({
      id: String(r.id),
      nombre: String(r.nombre ?? ""),
      sku: String(r.sku ?? ""),
      codigo_barras: (r.codigo_barras as string | null) ?? null,
      codigo_barras_interno: r.codigo_barras_interno === true,
      precio_venta: Number(r.precio_venta ?? 0),
      precio_mayorista: Number(r.precio_mayorista ?? 0),
      precio_distribuidor: r.precio_distribuidor != null ? Number(r.precio_distribuidor) : null,
      costo_promedio: Number(r.costo_promedio ?? 0),
      stock_actual: Number(r.stock_actual ?? 0),
      stock_minimo: Number(r.stock_minimo ?? 0),
      unidad_medida: String(r.unidad_medida ?? "UNIDAD"),
      metodo_valuacion: String(r.metodo_valuacion ?? "CPP"),
      imagen_path: (r.imagen_path as string | null) ?? null,
      imagen_url: (r.imagen_url as string | null) ?? null,
      es_vendible: r.es_vendible !== false,
      controla_stock: r.controla_stock !== false,
      modo_receta: typeof r.modo_receta === "string" ? r.modo_receta : "preparado_al_vender",
      discount_type:
        r.discount_type === "percentage" || r.discount_type === "fixed"
          ? (r.discount_type as "percentage" | "fixed")
          : null,
      discount_value: r.discount_value != null ? Number(r.discount_value) : null,
      discount_starts_at: (r.discount_starts_at as string | null) ?? null,
      discount_ends_at: (r.discount_ends_at as string | null) ?? null,
    }));

    // Firmar URLs solo para los primeros 20 visibles (optimización).
    const SIGN_TOP = 20;
    const signedUrls: (string | null)[] = await Promise.all(
      rows.slice(0, SIGN_TOP).map(async (r) =>
        r.imagen_path ? await signProductoImagen(supabase, r.imagen_path, 3600) : null
      )
    );

    const hits: ProductoSearchHit[] = rows.map((r, i) => ({
      id: r.id,
      nombre: r.nombre,
      sku: r.sku,
      codigo_barras: r.codigo_barras,
      codigo_barras_interno: r.codigo_barras_interno,
      precio_venta: r.precio_venta,
      precio_mayorista: r.precio_mayorista,
      precio_distribuidor: r.precio_distribuidor,
      costo_promedio: r.costo_promedio,
      stock_actual: r.stock_actual,
      stock_minimo: r.stock_minimo,
      unidad_medida: r.unidad_medida,
      metodo_valuacion: r.metodo_valuacion,
      imagen_path: r.imagen_path,
      imagen_url: (i < SIGN_TOP ? signedUrls[i] : null) ?? r.imagen_url ?? null,
      categoria_nombre: null,
      proveedor_nombre: null,
      ubicacion_nombre: null,
      ubicacion_tipo: null,
      es_vendible: r.es_vendible,
      controla_stock: r.controla_stock,
      modo_receta: r.modo_receta,
      discount_type: r.discount_type,
      discount_value: r.discount_value,
      discount_starts_at: r.discount_starts_at,
      discount_ends_at: r.discount_ends_at,
    }));

    return NextResponse.json(successResponse({ items: hits, count: hits.length, q }));
  } catch (err) {
    console.error("[/api/productos/search]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      errorResponse("No se pudo realizar la búsqueda. Intentá nuevamente."),
      { status: 500 }
    );
  }
}
