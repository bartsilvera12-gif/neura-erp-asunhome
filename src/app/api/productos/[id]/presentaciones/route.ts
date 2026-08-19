import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  PRESENTACION_COLS,
  mapPresentacion,
  setAsDefault,
  validatePresentacionInput,
} from "@/lib/inventario/presentaciones-server";

/**
 * GET /api/productos/[id]/presentaciones
 *   Lista todas las presentaciones del producto (activas e inactivas).
 *
 * POST /api/productos/[id]/presentaciones
 *   Crea una presentacion nueva.
 *   Body: { nombre, cantidad_base, precio_venta?, es_default?, activo? }
 */
export async function GET(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase, auth } = ctx;

    const { data, error } = await supabase
      .from("producto_presentaciones")
      .select(PRESENTACION_COLS)
      .eq("empresa_id", auth.empresa_id)
      .eq("producto_id", id)
      .order("es_default", { ascending: false })
      .order("cantidad_base", { ascending: true });

    if (error) throw new Error(error.message);
    const presentaciones = (((data ?? []) as unknown) as Record<string, unknown>[]).map(mapPresentacion);
    return NextResponse.json(successResponse({ presentaciones }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error.";
    console.error("[/api/productos/[id]/presentaciones GET]", msg);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id: productoId } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase, auth } = ctx;
    const empresaId = auth.empresa_id;

    // Verificar que el producto existe y pertenece a la empresa.
    const prod = await supabase
      .from("productos")
      .select("id")
      .eq("empresa_id", empresaId)
      .eq("id", productoId)
      .maybeSingle();
    if (!prod.data) {
      return NextResponse.json(errorResponse("Producto no encontrado."), { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as Partial<{
      nombre: string;
      cantidad_base: number;
      precio_venta: number | null;
      es_default: boolean;
      activo: boolean;
    }> | null;
    if (!body) return NextResponse.json(errorResponse("Body invalido."), { status: 400 });

    const valError = validatePresentacionInput(body);
    if (valError) return NextResponse.json(errorResponse(valError), { status: 400 });

    const nombre = (body.nombre ?? "").trim();
    const cantidadBase = Number(body.cantidad_base);
    const precioVenta = body.precio_venta == null ? null : Number(body.precio_venta);
    const esDefaultRequested = body.es_default === true;
    const activo = body.activo !== false;

    const ins = await supabase
      .from("producto_presentaciones")
      .insert({
        empresa_id: empresaId,
        producto_id: productoId,
        nombre,
        cantidad_base: cantidadBase,
        precio_venta: precioVenta,
        es_default: false, // se setea despues con setAsDefault si corresponde (evita race con indice unique parcial)
        activo,
      })
      .select(PRESENTACION_COLS)
      .single();
    if (ins.error) {
      const m = ins.error.message ?? "";
      if (/duplicate|23505/i.test(m)) {
        return NextResponse.json(
          errorResponse(`Ya existe una presentación con el nombre "${nombre}" en este producto.`),
          { status: 409 }
        );
      }
      throw new Error(m);
    }

    if (esDefaultRequested) {
      await setAsDefault(supabase, empresaId, productoId, String((ins.data as { id: string }).id));
    }

    // Releer para devolver el estado final
    const final = await supabase
      .from("producto_presentaciones")
      .select(PRESENTACION_COLS)
      .eq("id", (ins.data as { id: string }).id)
      .single();

    return NextResponse.json(
      successResponse({ presentacion: mapPresentacion(final.data as Record<string, unknown>) })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error.";
    console.error("[/api/productos/[id]/presentaciones POST]", msg);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
