import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { normalizeUpperText, normalizeUpperCodigoBarras } from "@/lib/text/normalize";
import { applyTokenSearch } from "@/lib/productos/token-search";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * GET/POST de productos via PostgREST (sin pool PG directo) — compatible Hostinger.
 */

const PRODUCTO_COLS =
  "id, empresa_id, nombre, sku, costo_promedio, precio_venta, stock_actual, stock_minimo, " +
  "unidad_medida, metodo_valuacion, activo, created_at, updated_at, " +
  "codigo_barras, codigo_barras_interno, imagen_path, imagen_url, " +
  "categoria_principal_id, ubicacion_principal_id, proveedor_principal_id, " +
  "es_vendible, es_insumo, controla_stock, destacado, oferta_semana_destacada, valorizado, unidad_compra, unidad_receta, " +
  "factor_compra_receta, tiempo_prep_minutos, descripcion, precio_mayorista, cantidad_minima_mayorista, precio_distribuidor, modo_receta, " +
  "discount_type, discount_value, discount_starts_at, discount_ends_at";

function toNumber(v: unknown): unknown {
  return typeof v === "string" ? Number(v) : v;
}
function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function rowToApi(r: Record<string, unknown>): Record<string, unknown> {
  return {
    ...r,
    costo_promedio: toNumber(r.costo_promedio),
    precio_venta: toNumber(r.precio_venta),
    stock_actual: toNumber(r.stock_actual),
    stock_minimo: toNumber(r.stock_minimo),
    factor_compra_receta: toNumber(r.factor_compra_receta),
    precio_mayorista: r.precio_mayorista != null ? toNumber(r.precio_mayorista) : null,
    cantidad_minima_mayorista: r.cantidad_minima_mayorista != null ? toNumber(r.cantidad_minima_mayorista) : null,
    precio_distribuidor: r.precio_distribuidor != null ? toNumber(r.precio_distribuidor) : null,
  };
}

async function existsId(
  sb: AppSupabaseClient,
  table: "categorias_productos" | "inventario_ubicaciones" | "proveedores",
  empresaId: string,
  id: string
): Promise<boolean> {
  const { data, error } = await sb
    .from(table)
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("id", id)
    .limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/**
 * GET /api/productos
 *
 * Devuelve productos del tenant. Soporta paginacion + filtros server-side:
 *  - q=<text>          Busqueda case-insensitive sobre nombre o sku
 *  - categoria=<uuid>  Filtra por categoria_principal_id.
 *                      Valor especial "__sin__" -> productos sin categoria.
 *  - limit=<n>         Tamano de pagina (default 25, max 500). 0 = sin limite.
 *  - offset=<n>        Offset de paginacion.
 *
 * Response: { productos: [...], total: number, limit, offset }
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { searchParams } = new URL(request.url);

    const q = searchParams.get("q")?.trim() ?? "";
    const categoria = searchParams.get("categoria");
    // Default sin paginar (limit=0) para preservar compat con callers que
    // esperan la lista completa (recetas, ventas, etc.). El listado del ERP
    // pasa limit explicito cuando quiere paginacion.
    const limitParam = searchParams.get("limit");
    const limitRaw = limitParam !== null ? parseInt(limitParam, 10) : 0;
    const offsetRaw = parseInt(searchParams.get("offset") ?? "0", 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(0, limitRaw), 500) : 0;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;

    /** Construye el query base con todos los filtros comunes. Se re-crea por
     *  cada chunk porque los builders de supabase-js no son reutilizables una
     *  vez ejecutados. */
    const buildBase = () => {
      let base = ctx.supabase
        .from("productos")
        .select(PRODUCTO_COLS, {
          // count: "planned" usa pg_stats en vez de COUNT(*) exacto.
          count: "planned",
        })
        .eq("empresa_id", ctx.auth.empresa_id)
        .eq("activo", true);
      if (q) base = applyTokenSearch(base, q, ["nombre", "sku"]);
      if (categoria === "__sin__") base = base.is("categoria_principal_id", null);
      else if (categoria) base = base.eq("categoria_principal_id", categoria);
      return base.order("nombre");
    };

    if (limit > 0) {
      const { data, error, count } = await buildBase().range(offset, offset + limit - 1);
      if (error) throw new Error(error.message);
      const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map(rowToApi);
      return NextResponse.json(
        successResponse({ productos: rows, total: count ?? 0, limit, offset })
      );
    }

    // limit=0 = "sin paginar". PostgREST/Supabase cortan silenciosamente a 1000
    // filas aunque pasemos un range mas grande (max-rows a nivel servidor).
    // Solucion: fetch por lotes de 1000 hasta agotar. Asi tenants con >1000
    // productos (Ferrecolor con miles) devuelven todo.
    const CHUNK = 1000;
    const MAX_TOTAL = 100_000; // guard-rail
    const allRows: Record<string, unknown>[] = [];
    let totalCount = 0;
    for (let from = 0; from < MAX_TOTAL; from += CHUNK) {
      const { data, error, count } = await buildBase().range(from, from + CHUNK - 1);
      if (error) throw new Error(error.message);
      const batch = (data ?? []) as unknown as Record<string, unknown>[];
      if (batch.length === 0) break;
      allRows.push(...batch);
      if (count != null) totalCount = count;
      if (batch.length < CHUNK) break;
    }
    const rows = allRows.map(rowToApi);
    return NextResponse.json(
      successResponse({ productos: rows, total: totalCount || rows.length, limit, offset })
    );
  } catch (err) {
    console.error("[/api/productos GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar los productos."), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sb = ctx.supabase;

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(errorResponse("JSON inválido."), { status: 400 });
    }

    const nombre = normalizeUpperText(body.nombre);
    const sku = normalizeUpperText(body.sku);
    if (!nombre) return NextResponse.json(errorResponse("El nombre es obligatorio."), { status: 400 });
    if (!sku) return NextResponse.json(errorResponse("El SKU es obligatorio."), { status: 400 });

    const codigoBarras = normalizeUpperCodigoBarras(body.codigo_barras);
    const codigoBarrasInterno = codigoBarras != null && body.codigo_barras_interno === true;
    const stockActual = Number(body.stock_actual ?? 0) || 0;
    const costoPromedio = Number(body.costo_promedio ?? 0) || 0;
    const stockMinimo = Number(body.stock_minimo ?? 0) || 0;
    const precioVenta = Number(body.precio_venta ?? 0) || 0;
    const unidadMedida = normalizeUpperText(body.unidad_medida) || "UNIDAD";
    const metodoValuacion =
      body.metodo_valuacion === "FIFO" || body.metodo_valuacion === "LIFO"
        ? (body.metodo_valuacion as "FIFO" | "LIFO")
        : "CPP";

    const categoriaPrincipalId = body.categoria_principal_id ? String(body.categoria_principal_id) : null;
    const ubicacionPrincipalId = body.ubicacion_principal_id ? String(body.ubicacion_principal_id) : null;
    const proveedorPrincipalId = body.proveedor_principal_id ? String(body.proveedor_principal_id) : null;

    const esVendible = typeof body.es_vendible === "boolean" ? body.es_vendible : undefined;
    const esInsumo = typeof body.es_insumo === "boolean" ? body.es_insumo : undefined;
    const controlaStock = typeof body.controla_stock === "boolean" ? body.controla_stock : undefined;
    const destacado = typeof body.destacado === "boolean" ? body.destacado : undefined;
    const discountType =
      body.discount_type === "percentage" || body.discount_type === "fixed"
        ? body.discount_type
        : body.discount_type === null || body.discount_type === ""
        ? null
        : undefined;
    const discountValueRaw = toNumber(body.discount_value);
    const discountValue =
      typeof discountValueRaw === "number" && discountValueRaw >= 0
        ? discountValueRaw
        : undefined;
    const discountStartsAt =
      typeof body.discount_starts_at === "string" && body.discount_starts_at.trim()
        ? body.discount_starts_at
        : body.discount_starts_at === null
        ? null
        : undefined;
    const discountEndsAt =
      typeof body.discount_ends_at === "string" && body.discount_ends_at.trim()
        ? body.discount_ends_at
        : body.discount_ends_at === null
        ? null
        : undefined;
    const valorizado = typeof body.valorizado === "boolean" ? body.valorizado : undefined;
    const unidadCompra =
      typeof body.unidad_compra === "string"
        ? body.unidad_compra.trim() || null
        : body.unidad_compra === null
        ? null
        : undefined;
    const unidadReceta =
      typeof body.unidad_receta === "string"
        ? body.unidad_receta.trim() || null
        : body.unidad_receta === null
        ? null
        : undefined;
    const factorCompraReceta =
      typeof body.factor_compra_receta === "number" && body.factor_compra_receta > 0
        ? body.factor_compra_receta
        : undefined;
    const tiempoPrepMinutos =
      typeof body.tiempo_prep_minutos === "number" && body.tiempo_prep_minutos >= 0
        ? Math.floor(body.tiempo_prep_minutos)
        : undefined;

    // Validar ownership de relaciones opcionales
    if (categoriaPrincipalId && !(await existsId(sb, "categorias_productos", empresaId, categoriaPrincipalId))) {
      return NextResponse.json(errorResponse("La categoría seleccionada no existe."), { status: 400 });
    }
    if (ubicacionPrincipalId && !(await existsId(sb, "inventario_ubicaciones", empresaId, ubicacionPrincipalId))) {
      return NextResponse.json(errorResponse("La ubicación seleccionada no existe."), { status: 400 });
    }
    if (proveedorPrincipalId && !(await existsId(sb, "proveedores", empresaId, proveedorPrincipalId))) {
      return NextResponse.json(errorResponse("El proveedor seleccionado no existe."), { status: 400 });
    }

    // Insert principal
    const insertPayload: Record<string, unknown> = {
      empresa_id: empresaId,
      nombre,
      sku,
      costo_promedio: costoPromedio,
      precio_venta: precioVenta,
      stock_actual: stockActual,
      stock_minimo: stockMinimo,
      unidad_medida: unidadMedida,
      metodo_valuacion: metodoValuacion,
      codigo_barras: codigoBarras,
      codigo_barras_interno: codigoBarras ? codigoBarrasInterno : false,
      categoria_principal_id: categoriaPrincipalId,
      ubicacion_principal_id: ubicacionPrincipalId,
      proveedor_principal_id: proveedorPrincipalId,
    };
    if (esVendible !== undefined) insertPayload.es_vendible = esVendible;
    if (esInsumo !== undefined) insertPayload.es_insumo = esInsumo;
    if (controlaStock !== undefined) insertPayload.controla_stock = controlaStock;
    if (destacado !== undefined) insertPayload.destacado = destacado;
    if (discountType !== undefined) insertPayload.discount_type = discountType;
    if (discountValue !== undefined) insertPayload.discount_value = discountValue;
    if (discountStartsAt !== undefined) insertPayload.discount_starts_at = discountStartsAt;
    if (discountEndsAt !== undefined) insertPayload.discount_ends_at = discountEndsAt;
    if (valorizado !== undefined) insertPayload.valorizado = valorizado;
    if (unidadCompra !== undefined) insertPayload.unidad_compra = unidadCompra;
    if (unidadReceta !== undefined) insertPayload.unidad_receta = unidadReceta;
    if (factorCompraReceta !== undefined) insertPayload.factor_compra_receta = factorCompraReceta;
    if (tiempoPrepMinutos !== undefined) insertPayload.tiempo_prep_minutos = tiempoPrepMinutos;
    const descripcion = typeof body.descripcion === "string" ? body.descripcion.trim() || null : (body.descripcion === null ? null : undefined);
    if (descripcion !== undefined) insertPayload.descripcion = descripcion;
    insertPayload.precio_mayorista = toNumberOrNull(body.precio_mayorista);
    insertPayload.cantidad_minima_mayorista = toNumberOrNull(body.cantidad_minima_mayorista);
    insertPayload.precio_distribuidor = toNumberOrNull(body.precio_distribuidor);
    if (body.modo_receta === "produccion_previa" || body.modo_receta === "preparado_al_vender") {
      insertPayload.modo_receta = body.modo_receta;
    }

    const ins = await sb.from("productos").insert(insertPayload).select(PRODUCTO_COLS).single();
    if (ins.error) {
      const msg = ins.error.message ?? "";
      if (/duplicate key|unique|23505/i.test(msg)) {
        if (/sku/i.test(msg)) {
          return NextResponse.json(errorResponse("Ya existe un producto con ese SKU."), { status: 409 });
        }
        if (/codigo_barras|barras/i.test(msg)) {
          return NextResponse.json(errorResponse("Ya existe un producto con ese código de barras."), {
            status: 409,
          });
        }
        return NextResponse.json(errorResponse("Ya existe un producto con datos únicos en conflicto."), {
          status: 409,
        });
      }
      console.error("[/api/productos POST] insert", msg);
      return NextResponse.json(errorResponse("No se pudo guardar el producto."), { status: 500 });
    }
    const row = ins.data as unknown as Record<string, unknown>;
    const productoId = String(row.id);

    // Sembrar presentacion default "Unidad" cantidad_base=1. Best-effort:
    // si falla, el producto se crea igual. El sidebar de presentaciones en
    // editar producto la ofrece crear si no existe. Mantiene la invariante
    // de que cada producto tiene al menos una presentacion activa.
    try {
      const { ensureDefaultPresentacion } = await import(
        "@/lib/inventario/presentaciones-server"
      );
      await ensureDefaultPresentacion(
        sb,
        empresaId,
        productoId,
        typeof row.unidad_medida === "string" ? row.unidad_medida : null
      );
    } catch (e) {
      console.error(
        "[/api/productos POST] ensureDefaultPresentacion",
        e instanceof Error ? e.message : e
      );
    }

    // Movimiento de inventario inicial — solo si controla_stock=true Y stock>0
    let movWarning: string | null = null;
    const controlaStockFinal = row.controla_stock !== false;
    if (stockActual > 0 && controlaStockFinal) {
      const movIns = await sb.from("movimientos_inventario").insert({
        empresa_id: empresaId,
        producto_id: productoId,
        producto_nombre: nombre,
        producto_sku: sku,
        tipo: "ENTRADA",
        cantidad: stockActual,
        costo_unitario: costoPromedio,
        origen: "inventario_inicial",
        referencia: null,
      });
      if (movIns.error) {
        console.error("[/api/productos POST] inventario_inicial", movIns.error.message);
        movWarning = "El producto se guardó pero no se pudo registrar el movimiento inicial de stock.";
      }
    }

    // Categoría principal: insertar en puente producto_categorias
    if (categoriaPrincipalId) {
      const pc = await sb.from("producto_categorias").insert({
        empresa_id: empresaId,
        producto_id: productoId,
        categoria_id: categoriaPrincipalId,
        es_principal: true,
      });
      if (pc.error) {
        console.error("[/api/productos POST] producto_categorias", pc.error.message);
      }
    }

    // Stock por ubicación (solo si aplica)
    if (ubicacionPrincipalId && stockActual > 0 && controlaStockFinal) {
      const su = await sb.from("inventario_stock_ubicacion").insert({
        empresa_id: empresaId,
        producto_id: productoId,
        ubicacion_id: ubicacionPrincipalId,
        stock_actual: stockActual,
        es_principal: true,
      });
      if (su.error) {
        console.error("[/api/productos POST] inventario_stock_ubicacion", su.error.message);
      }
    }

    return NextResponse.json(successResponse({ producto: rowToApi(row), warning: movWarning }));
  } catch (err) {
    console.error("[/api/productos POST] outer", err instanceof Error ? err.message : err);
    return NextResponse.json(
      errorResponse("No se pudo guardar el producto. Revisá los datos e intentá nuevamente."),
      { status: 500 }
    );
  }
}
