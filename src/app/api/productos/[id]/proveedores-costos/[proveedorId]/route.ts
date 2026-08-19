import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * PATCH /api/productos/[id]/proveedores-costos/[proveedorId]
 *
 * Define/actualiza la `marca` que un proveedor maneja para un producto.
 * Hace upsert en `proveedor_productos` (relación producto+proveedor) sin tocar
 * costo_habitual ni es_principal. Solo schema actual (vía tenant). Autenticado.
 *
 * Body: { marca: string | null }
 */

function normalizeMarca(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, 120);
}

export async function PATCH(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string; proveedorId: string }> }
) {
  try {
    const { id: productoId, proveedorId } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sb = ctx.supabase;

    if (!productoId || !proveedorId) {
      return NextResponse.json(errorResponse("Faltan identificadores."), { status: 400 });
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(errorResponse("JSON inválido."), { status: 400 });
    }
    const marca = normalizeMarca(body.marca);

    // Validar que el producto pertenece a la empresa (permiso inventario).
    const prod = await sb
      .from("productos")
      .select("id")
      .eq("empresa_id", empresaId)
      .eq("id", productoId)
      .maybeSingle();
    if (prod.error) throw new Error(prod.error.message);
    if (!prod.data) return NextResponse.json(errorResponse("El producto no existe."), { status: 404 });

    // Validar que el proveedor pertenece a la empresa.
    const prov = await sb
      .from("proveedores")
      .select("id")
      .eq("empresa_id", empresaId)
      .eq("id", proveedorId)
      .maybeSingle();
    if (prov.error) throw new Error(prov.error.message);
    if (!prov.data) return NextResponse.json(errorResponse("El proveedor no existe."), { status: 404 });

    // Upsert: matchea por (empresa_id, producto_id, proveedor_id). Solo setea marca.
    // No toca costo_habitual ni es_principal (no se incluyen en el payload).
    const up = await sb
      .from("proveedor_productos")
      .upsert(
        { empresa_id: empresaId, producto_id: productoId, proveedor_id: proveedorId, marca },
        { onConflict: "empresa_id,producto_id,proveedor_id" }
      )
      .select("proveedor_id, marca")
      .single();
    if (up.error) {
      console.error("[proveedores-costos PATCH] upsert", up.error.message);
      return NextResponse.json(errorResponse("No se pudo guardar la marca."), { status: 500 });
    }

    const row = up.data as unknown as { proveedor_id: string; marca: string | null };
    return NextResponse.json(successResponse({ proveedor_id: row.proveedor_id, marca: row.marca ?? null }));
  } catch (err) {
    console.error("[proveedores-costos PATCH] outer", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo guardar la marca."), { status: 500 });
  }
}
