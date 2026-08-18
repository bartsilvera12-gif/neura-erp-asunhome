import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { normalizeUpperText, normalizeUpperCodigoBarras } from "@/lib/text/normalize";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * GET/POST de productos via PostgREST (sin pool PG directo) — compatible Hostinger.
 */

const PRODUCTO_COLS =
  "id, empresa_id, nombre, sku, costo_promedio, precio_venta, stock_actual, stock_minimo, " +
  "unidad_medida, metodo_valuacion, activo, created_at, updated_at, " +
  "codigo_barras, codigo_barras_interno, imagen_path, imagen_url, " +
  "categoria_principal_id, ubicacion_principal_id, proveedor_principal_id, " +
  "es_vendible, es_insumo, controla_stock, valorizado, unidad_compra, unidad_receta, " +
  "factor_compra_receta, tiempo_prep_minutos, descripcion";

function toNumber(v: unknown): unknown {
  return typeof v === "string" ? Number(v) : v;
}
function rowToApi(r: Record<string, unknown>): Record<string, unknown> {
  return {
    ...r,
    costo_promedio: toNumber(r.costo_promedio),
    precio_venta: toNumber(r.precio_venta),
    stock_actual: toNumber(r.stock_actual),
    stock_minimo: toNumber(r.stock_minimo),
    factor_compra_receta: toNumber(r.factor_compra_receta),
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

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { data, error } = await ctx.supabase
      .from("productos")
      .select(PRODUCTO_COLS)
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("activo", true)
      .order("nombre");
    if (error) throw new Error(error.message);
    const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map(rowToApi);
    return NextResponse.json(successResponse({ productos: rows }));
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
    if (valorizado !== undefined) insertPayload.valorizado = valorizado;
    if (unidadCompra !== undefined) insertPayload.unidad_compra = unidadCompra;
    if (unidadReceta !== undefined) insertPayload.unidad_receta = unidadReceta;
    if (factorCompraReceta !== undefined) insertPayload.factor_compra_receta = factorCompraReceta;
    if (tiempoPrepMinutos !== undefined) insertPayload.tiempo_prep_minutos = tiempoPrepMinutos;
    const descripcion = typeof body.descripcion === "string" ? body.descripcion.trim() || null : (body.descripcion === null ? null : undefined);
    if (descripcion !== undefined) insertPayload.descripcion = descripcion;

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
