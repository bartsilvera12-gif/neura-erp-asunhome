import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { normalizeUpperText, normalizeUpperNullable } from "@/lib/text/normalize";

/**
 * GET/POST de categorías de productos vía PostgREST (cliente Supabase).
 * Reescrito desde pool PG directo porque Hostinger no expone DATABASE_URL.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const url = new URL(request.url);
    const todas = url.searchParams.get("todas") === "1";

    let q = ctx.supabase
      .from("categorias_productos")
      .select("id, empresa_id, nombre, codigo, descripcion, parent_id, activo, created_at, updated_at")
      .eq("empresa_id", ctx.auth.empresa_id)
      .order("nombre");
    if (!todas) q = q.eq("activo", true);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return NextResponse.json(successResponse({ categorias: data ?? [] }));
  } catch (err) {
    console.error("[/api/inventario/categorias GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las categorías."), { status: 500 });
  }
}

/** Genera un código simple a partir del nombre: "BEBIDAS" → "bebidas". */
function slugifyCodigo(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "categoria";
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const nombre = normalizeUpperText(body.nombre);
    if (!nombre) return NextResponse.json(errorResponse("El nombre es obligatorio."), { status: 400 });

    // Pre-check duplicado por nombre (case-insensitive vía ilike).
    const dup = await ctx.supabase
      .from("categorias_productos")
      .select("id")
      .eq("empresa_id", ctx.auth.empresa_id)
      .ilike("nombre", nombre)
      .limit(1);
    if (dup.error) {
      console.error("[/api/inventario/categorias POST] pre-check", dup.error.message);
      return NextResponse.json(errorResponse("No se pudo crear la categoría."), { status: 500 });
    }
    if ((dup.data ?? []).length > 0) {
      return NextResponse.json(
        errorResponse("Ya existe una categoría con ese nombre."),
        { status: 409 }
      );
    }

    const codigoIn = normalizeUpperNullable(body.codigo);
    const codigo = codigoIn && codigoIn.trim().length > 0 ? codigoIn.trim() : slugifyCodigo(nombre);

    const ins = await ctx.supabase
      .from("categorias_productos")
      .insert({
        empresa_id: ctx.auth.empresa_id,
        nombre,
        codigo,
        descripcion: normalizeUpperNullable(body.descripcion) ?? null,
        parent_id: body.parent_id == null ? null : String(body.parent_id),
        activo: body.activo === false ? false : true,
      })
      .select("id, empresa_id, nombre, codigo, descripcion, parent_id, activo, created_at, updated_at")
      .single();
    if (ins.error) {
      const msg = ins.error.message ?? "";
      if (/uq_categorias_productos_empresa_nombre|duplicate|unique/i.test(msg)) {
        return NextResponse.json(
          errorResponse("Ya existe una categoría con ese nombre o código."),
          { status: 409 }
        );
      }
      console.error("[/api/inventario/categorias POST] insert", msg);
      return NextResponse.json(errorResponse("No se pudo crear la categoría."), { status: 500 });
    }
    return NextResponse.json(successResponse({ categoria: ins.data }));
  } catch (err) {
    console.error("[/api/inventario/categorias POST] outer", err);
    return NextResponse.json(errorResponse("No se pudo crear la categoría."), { status: 500 });
  }
}
