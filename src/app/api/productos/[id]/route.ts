import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { normalizeUpperText, normalizeUpperCodigoBarras } from "@/lib/text/normalize";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

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

export async function GET(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { data, error } = await ctx.supabase
      .from("productos")
      .select(PRODUCTO_COLS)
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    return NextResponse.json(successResponse({ producto: rowToApi(data as unknown as Record<string, unknown>) }));
  } catch (err) {
    console.error("[/api/productos/[id] GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el producto."), { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctxParams.params;
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

    const patch: Record<string, unknown> = {};
    if (body.nombre !== undefined) patch.nombre = normalizeUpperText(body.nombre);
    if (body.sku !== undefined) patch.sku = normalizeUpperText(body.sku);
    if (body.costo_promedio !== undefined) patch.costo_promedio = Number(body.costo_promedio) || 0;
    if (body.precio_venta !== undefined) patch.precio_venta = Number(body.precio_venta) || 0;
    if (body.stock_actual !== undefined) patch.stock_actual = Number(body.stock_actual) || 0;
    if (body.stock_minimo !== undefined) patch.stock_minimo = Number(body.stock_minimo) || 0;
    if (body.unidad_medida !== undefined) patch.unidad_medida = normalizeUpperText(body.unidad_medida) || "UNIDAD";
    if (body.metodo_valuacion !== undefined) {
      const mv = body.metodo_valuacion;
      patch.metodo_valuacion = mv === "FIFO" || mv === "LIFO" ? mv : "CPP";
    }
    if (body.codigo_barras !== undefined) patch.codigo_barras = normalizeUpperCodigoBarras(body.codigo_barras);
    if (body.codigo_barras_interno !== undefined) patch.codigo_barras_interno = body.codigo_barras_interno === true;
    if (body.imagen_path !== undefined) {
      const v = body.imagen_path != null ? String(body.imagen_path) : "";
      patch.imagen_path = v || null;
    }
    if (body.imagen_url !== undefined) {
      const v = body.imagen_url != null ? String(body.imagen_url) : "";
      patch.imagen_url = v || null;
    }

    let categoriaCambia = false;
    let categoriaNueva: string | null = null;
    if (body.categoria_principal_id !== undefined) {
      const v = body.categoria_principal_id == null ? null : String(body.categoria_principal_id);
      if (v && !(await existsId(sb, "categorias_productos", empresaId, v))) {
        return NextResponse.json(errorResponse("La categoría seleccionada no existe."), { status: 400 });
      }
      patch.categoria_principal_id = v;
      categoriaCambia = true;
      categoriaNueva = v;
    }
    if (body.ubicacion_principal_id !== undefined) {
      const v = body.ubicacion_principal_id == null ? null : String(body.ubicacion_principal_id);
      if (v && !(await existsId(sb, "inventario_ubicaciones", empresaId, v))) {
        return NextResponse.json(errorResponse("La ubicación seleccionada no existe."), { status: 400 });
      }
      patch.ubicacion_principal_id = v;
    }
    if (body.proveedor_principal_id !== undefined) {
      const v = body.proveedor_principal_id == null ? null : String(body.proveedor_principal_id);
      if (v && !(await existsId(sb, "proveedores", empresaId, v))) {
        return NextResponse.json(errorResponse("El proveedor seleccionado no existe."), { status: 400 });
      }
      patch.proveedor_principal_id = v;
    }
    if (typeof body.es_vendible === "boolean") patch.es_vendible = body.es_vendible;
    if (typeof body.es_insumo === "boolean") patch.es_insumo = body.es_insumo;
    if (typeof body.controla_stock === "boolean") patch.controla_stock = body.controla_stock;
    if (typeof body.valorizado === "boolean") patch.valorizado = body.valorizado;
    if (body.unidad_compra !== undefined)
      patch.unidad_compra = body.unidad_compra == null ? null : String(body.unidad_compra).trim() || null;
    if (body.unidad_receta !== undefined)
      patch.unidad_receta = body.unidad_receta == null ? null : String(body.unidad_receta).trim() || null;
    if (typeof body.factor_compra_receta === "number" && body.factor_compra_receta > 0)
      patch.factor_compra_receta = body.factor_compra_receta;
    if (typeof body.tiempo_prep_minutos === "number" && body.tiempo_prep_minutos >= 0)
      patch.tiempo_prep_minutos = Math.floor(body.tiempo_prep_minutos);
    if (body.descripcion !== undefined)
      patch.descripcion = body.descripcion == null ? null : String(body.descripcion).trim() || null;

    if (Object.keys(patch).length === 0) {
      const { data: existing, error: errGet } = await sb
        .from("productos")
        .select(PRODUCTO_COLS)
        .eq("empresa_id", empresaId)
        .eq("id", id)
        .maybeSingle();
      if (errGet) throw new Error(errGet.message);
      if (!existing) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
      return NextResponse.json(successResponse({ producto: rowToApi(existing as unknown as Record<string, unknown>) }));
    }

    const upd = await sb
      .from("productos")
      .update(patch)
      .eq("empresa_id", empresaId)
      .eq("id", id)
      .select(PRODUCTO_COLS)
      .maybeSingle();
    if (upd.error) {
      const msg = upd.error.message ?? "";
      if (/duplicate key|unique|23505/i.test(msg)) {
        if (/sku/i.test(msg)) return NextResponse.json(errorResponse("Ya existe un producto con ese SKU."), { status: 409 });
        if (/codigo_barras|barras/i.test(msg))
          return NextResponse.json(errorResponse("Ya existe un producto con ese código de barras."), { status: 409 });
        return NextResponse.json(errorResponse("Conflicto de datos únicos."), { status: 409 });
      }
      console.error("[/api/productos/[id] PATCH]", msg);
      return NextResponse.json(errorResponse("No se pudo actualizar el producto."), { status: 500 });
    }
    if (!upd.data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    const updRow = upd.data as unknown as Record<string, unknown>;

    // Sincronizar categoría principal en puente producto_categorias
    if (categoriaCambia) {
      try {
        // Limpiar es_principal anterior
        await sb
          .from("producto_categorias")
          .update({ es_principal: false })
          .eq("empresa_id", empresaId)
          .eq("producto_id", id)
          .eq("es_principal", true);
        if (categoriaNueva) {
          // Upsert manual: chequear si existe, sino insertar
          const { data: existing } = await sb
            .from("producto_categorias")
            .select("id")
            .eq("empresa_id", empresaId)
            .eq("producto_id", id)
            .eq("categoria_id", categoriaNueva)
            .limit(1);
          if ((existing ?? []).length > 0) {
            await sb
              .from("producto_categorias")
              .update({ es_principal: true })
              .eq("empresa_id", empresaId)
              .eq("producto_id", id)
              .eq("categoria_id", categoriaNueva);
          } else {
            await sb.from("producto_categorias").insert({
              empresa_id: empresaId,
              producto_id: id,
              categoria_id: categoriaNueva,
              es_principal: true,
            });
          }
        }
      } catch (err) {
        console.error("[/api/productos/[id] PATCH] sync producto_categorias", err instanceof Error ? err.message : err);
      }
    }

    return NextResponse.json(successResponse({ producto: rowToApi(updRow) }));
  } catch (err) {
    console.error("[/api/productos/[id] PATCH] outer", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo actualizar el producto."), { status: 500 });
  }
}
