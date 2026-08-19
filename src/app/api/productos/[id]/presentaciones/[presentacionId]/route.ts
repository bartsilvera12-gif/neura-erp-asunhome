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
 * PATCH /api/productos/[id]/presentaciones/[presentacionId]
 *   Edita una presentacion. Campos editables: nombre, cantidad_base,
 *   precio_venta, es_default, activo.
 *
 * DELETE /api/productos/[id]/presentaciones/[presentacionId]
 *   Soft delete: marca activo=false. No hard delete para no romper
 *   ventas historicas que referencian la presentacion.
 *   Restriccion: no se puede desactivar la unica presentacion default
 *   activa (el producto debe siempre tener al menos una default).
 */
export async function PATCH(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string; presentacionId: string }> }
) {
  try {
    const { id: productoId, presentacionId } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase, auth } = ctx;
    const empresaId = auth.empresa_id;

    const body = (await request.json().catch(() => null)) as Partial<{
      nombre: string;
      cantidad_base: number;
      precio_venta: number | null;
      es_default: boolean;
      activo: boolean;
    }> | null;
    if (!body) return NextResponse.json(errorResponse("Body invalido."), { status: 400 });

    const current = await supabase
      .from("producto_presentaciones")
      .select(PRESENTACION_COLS)
      .eq("empresa_id", empresaId)
      .eq("producto_id", productoId)
      .eq("id", presentacionId)
      .maybeSingle();
    if (!current.data) {
      return NextResponse.json(errorResponse("Presentación no encontrada."), { status: 404 });
    }
    const existente = mapPresentacion(current.data as Record<string, unknown>);

    // Validar solo los campos enviados.
    const valInput: Partial<{ nombre: string; cantidad_base: number; precio_venta: number | null }> = {};
    if (body.nombre !== undefined) valInput.nombre = body.nombre;
    if (body.cantidad_base !== undefined) valInput.cantidad_base = body.cantidad_base;
    if (body.precio_venta !== undefined) valInput.precio_venta = body.precio_venta;
    // Si no se manda nombre/cantidad nuevos, usar los actuales para la validacion.
    valInput.nombre = valInput.nombre ?? existente.nombre;
    valInput.cantidad_base = valInput.cantidad_base ?? existente.cantidad_base;
    valInput.precio_venta = valInput.precio_venta === undefined ? existente.precio_venta : valInput.precio_venta;

    const valError = validatePresentacionInput(valInput);
    if (valError) return NextResponse.json(errorResponse(valError), { status: 400 });

    const patch: Record<string, unknown> = {};
    if (body.nombre !== undefined) patch.nombre = String(body.nombre).trim();
    if (body.cantidad_base !== undefined) patch.cantidad_base = Number(body.cantidad_base);
    if (body.precio_venta !== undefined) patch.precio_venta = body.precio_venta == null ? null : Number(body.precio_venta);
    // es_default y activo se manejan abajo con cuidado especial.

    // Caso: intentan desactivar la default. Solo permitir si hay OTRA default
    // implicita (es decir, si el caller pasa es_default=false y otra distinta
    // ya es default activa). En general bloqueamos para evitar productos sin
    // default.
    if (body.activo === false && existente.es_default) {
      return NextResponse.json(
        errorResponse(
          "No podés desactivar la presentación por defecto. Marcá otra como por defecto primero."
        ),
        { status: 409 }
      );
    }

    if (body.activo !== undefined) patch.activo = body.activo === true;

    if (Object.keys(patch).length > 0) {
      const upd = await supabase
        .from("producto_presentaciones")
        .update(patch)
        .eq("empresa_id", empresaId)
        .eq("id", presentacionId);
      if (upd.error) {
        const m = upd.error.message ?? "";
        if (/duplicate|23505/i.test(m)) {
          return NextResponse.json(
            errorResponse(`Ya existe una presentación con ese nombre en este producto.`),
            { status: 409 }
          );
        }
        throw new Error(m);
      }
    }

    // Manejo del flag es_default — si lo marca como default, usar el helper
    // que desmarca a las demas.
    if (body.es_default === true && !existente.es_default) {
      await setAsDefault(supabase, empresaId, productoId, presentacionId);
    } else if (body.es_default === false && existente.es_default) {
      // Quitar el flag default solo si hay OTRA presentacion default activa.
      // Caso normal: el caller marca otra primero — la nuestra ya quedo en false
      // por setAsDefault desde el otro PATCH. Aca solo bloqueamos quitar el
      // ultimo default.
      const { count } = await supabase
        .from("producto_presentaciones")
        .select("id", { count: "exact", head: true })
        .eq("empresa_id", empresaId)
        .eq("producto_id", productoId)
        .eq("activo", true)
        .eq("es_default", true)
        .neq("id", presentacionId);
      if (!count || count === 0) {
        return NextResponse.json(
          errorResponse("Tiene que haber al menos una presentación por defecto. Marcá otra primero."),
          { status: 409 }
        );
      }
      await supabase
        .from("producto_presentaciones")
        .update({ es_default: false })
        .eq("id", presentacionId);
    }

    const final = await supabase
      .from("producto_presentaciones")
      .select(PRESENTACION_COLS)
      .eq("id", presentacionId)
      .single();

    return NextResponse.json(
      successResponse({ presentacion: mapPresentacion(final.data as Record<string, unknown>) })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error.";
    console.error("[/api/productos/[id]/presentaciones/[pid] PATCH]", msg);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string; presentacionId: string }> }
) {
  try {
    const { id: productoId, presentacionId } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase, auth } = ctx;
    const empresaId = auth.empresa_id;

    const current = await supabase
      .from("producto_presentaciones")
      .select("id, es_default, activo")
      .eq("empresa_id", empresaId)
      .eq("producto_id", productoId)
      .eq("id", presentacionId)
      .maybeSingle();
    if (!current.data) {
      return NextResponse.json(errorResponse("Presentación no encontrada."), { status: 404 });
    }
    const row = current.data as { es_default: boolean; activo: boolean };
    if (row.es_default && row.activo) {
      return NextResponse.json(
        errorResponse(
          "No podés eliminar la presentación por defecto. Marcá otra como por defecto primero."
        ),
        { status: 409 }
      );
    }

    const upd = await supabase
      .from("producto_presentaciones")
      .update({ activo: false })
      .eq("empresa_id", empresaId)
      .eq("id", presentacionId);
    if (upd.error) throw new Error(upd.error.message);

    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error.";
    console.error("[/api/productos/[id]/presentaciones/[pid] DELETE]", msg);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
