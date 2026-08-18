import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  ALLOWED_IMAGE_MIME,
  MAX_IMAGE_BYTES,
  PRODUCTOS_IMAGENES_BUCKET,
  buildProductoImagenPath,
  ensureProductosImagenesBucket,
  pathBelongsToEmpresa,
  signProductoImagen,
} from "@/lib/inventario/imagen-storage";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Imagen de producto — usa Storage de Supabase + PostgREST (no pool PG).
 * Compatible con Hostinger sin SUPABASE_DB_URL.
 */

async function fetchProducto(
  sb: AppSupabaseClient,
  empresaId: string,
  productoId: string
): Promise<{ id: string; imagen_path: string | null } | null> {
  const { data, error } = await sb
    .from("productos")
    .select("id, imagen_path")
    .eq("empresa_id", empresaId)
    .eq("id", productoId)
    .maybeSingle();
  if (error) {
    console.error("[productos imagen] fetchProducto", error.message);
    return null;
  }
  return (data as { id: string; imagen_path: string | null } | null) ?? null;
}

export async function GET(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id: productoId } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const prod = await fetchProducto(ctx.supabase, ctx.auth.empresa_id, productoId);
    if (!prod) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });

    const signed = prod.imagen_path
      ? await signProductoImagen(ctx.supabase, prod.imagen_path, 3600)
      : null;
    return NextResponse.json(
      successResponse({ imagen_path: prod.imagen_path, imagen_url: signed })
    );
  } catch (err) {
    console.error("[/api/productos/[id]/imagen GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo obtener la imagen."), { status: 500 });
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

    // 1) Ownership via PostgREST
    const prod = await fetchProducto(supabase, empresaId, productoId);
    if (!prod) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });

    // 2) Archivo
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(errorResponse("Falta el archivo (campo 'file')."), { status: 400 });
    }
    if (!ALLOWED_IMAGE_MIME.has(file.type)) {
      return NextResponse.json(
        errorResponse("Formato no permitido. Usá JPG, PNG o WebP."),
        { status: 400 }
      );
    }
    if (file.size > MAX_IMAGE_BYTES) {
      const mb = (MAX_IMAGE_BYTES / 1024 / 1024).toFixed(0);
      return NextResponse.json(
        errorResponse(`Imagen demasiado grande (máx. ${mb} MB).`),
        { status: 413 }
      );
    }

    // 3) Bucket idempotente
    try {
      await ensureProductosImagenesBucket(supabase);
    } catch (bucketErr) {
      console.error("[/api/productos/[id]/imagen POST] ensureBucket", bucketErr instanceof Error ? bucketErr.message : bucketErr);
      // Continuar: si el bucket ya existe en DB pero el ensure falla por permisos, el upload podría andar igual.
    }

    // 4) Borrar imagen anterior si pertenece a la empresa
    if (prod.imagen_path && pathBelongsToEmpresa(prod.imagen_path, empresaId)) {
      await supabase.storage.from(PRODUCTOS_IMAGENES_BUCKET).remove([prod.imagen_path]);
    }

    // 5) Upload nuevo
    const path = buildProductoImagenPath(empresaId, productoId, file.type);
    const buf = Buffer.from(await file.arrayBuffer());
    const up = await supabase.storage
      .from(PRODUCTOS_IMAGENES_BUCKET)
      .upload(path, buf, { contentType: file.type, upsert: true });
    if (up.error) {
      console.error("[/api/productos/[id]/imagen POST] upload", { empresaId, productoId, message: up.error.message });
      return NextResponse.json(
        errorResponse(`No se pudo subir la imagen: ${up.error.message}`),
        { status: 500 }
      );
    }

    // 6) Persistir imagen_path via PostgREST
    const upd = await supabase
      .from("productos")
      .update({ imagen_path: path, imagen_url: null })
      .eq("empresa_id", empresaId)
      .eq("id", productoId)
      .select("id, imagen_path")
      .maybeSingle();
    if (upd.error) {
      console.error("[/api/productos/[id]/imagen POST] update", upd.error.message);
      return NextResponse.json(errorResponse("No se pudo asociar la imagen al producto."), { status: 500 });
    }

    // 7) Signed URL para preview
    const signed = await signProductoImagen(supabase, path, 3600);
    return NextResponse.json(successResponse({ imagen_path: path, imagen_url: signed }));
  } catch (err) {
    console.error("[/api/productos/[id]/imagen POST] outer", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo subir la imagen."), { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id: productoId } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase, auth } = ctx;
    const empresaId = auth.empresa_id;

    const prod = await fetchProducto(supabase, empresaId, productoId);
    if (!prod) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });

    if (prod.imagen_path && pathBelongsToEmpresa(prod.imagen_path, empresaId)) {
      await supabase.storage.from(PRODUCTOS_IMAGENES_BUCKET).remove([prod.imagen_path]);
    }

    await supabase
      .from("productos")
      .update({ imagen_path: null, imagen_url: null })
      .eq("empresa_id", empresaId)
      .eq("id", productoId);

    return NextResponse.json(successResponse({ imagen_path: null, imagen_url: null }));
  } catch (err) {
    console.error("[/api/productos/[id]/imagen DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo quitar la imagen."), { status: 500 });
  }
}
