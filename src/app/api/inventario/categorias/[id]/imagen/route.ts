import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  ALLOWED_CATEGORIA_IMAGE_MIME,
  CATEGORIAS_IMAGENES_BUCKET,
  MAX_CATEGORIA_IMAGE_BYTES,
  buildCategoriaImagenPath,
  ensureCategoriasImagenesBucket,
} from "@/lib/inventario/categoria-imagen-storage";

/**
 * POST /api/inventario/categorias/[id]/imagen
 *
 * Sube una imagen para la categoria al bucket PUBLICO `categorias-imagenes`,
 * actualiza `imagen_url` en la fila con la URL publica resultante y la
 * devuelve. Si ya habia imagen, la sobreescribe (mismo path por categoria).
 *
 * Form: { file: File }
 * Limites: 10 MB, jpg/png/webp.
 */
export async function POST(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), {
        status: 401,
      });
    }
    const { supabase, auth } = ctx;
    const empresaId = auth.empresa_id;

    // Verificar que la categoria existe y pertenece a la empresa.
    const cat = await supabase
      .from("categorias_productos")
      .select("id")
      .eq("empresa_id", empresaId)
      .eq("id", id)
      .maybeSingle();
    if (cat.error) throw new Error(cat.error.message);
    if (!cat.data) {
      return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), {
        status: 404,
      });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        errorResponse("Falta el archivo (campo 'file')."),
        { status: 400 }
      );
    }
    if (!ALLOWED_CATEGORIA_IMAGE_MIME.has(file.type)) {
      return NextResponse.json(
        errorResponse("Formato no permitido. Usá JPG, PNG o WebP."),
        { status: 400 }
      );
    }
    if (file.size > MAX_CATEGORIA_IMAGE_BYTES) {
      const mb = (MAX_CATEGORIA_IMAGE_BYTES / 1024 / 1024).toFixed(0);
      return NextResponse.json(
        errorResponse(`Archivo demasiado grande (máx. ${mb} MB).`),
        { status: 413 }
      );
    }

    try {
      await ensureCategoriasImagenesBucket(supabase);
    } catch (bucketErr) {
      console.error(
        "[categorias/imagen] ensureBucket",
        bucketErr instanceof Error ? bucketErr.message : bucketErr
      );
    }

    const path = buildCategoriaImagenPath(empresaId, id, file.type);
    const buf = Buffer.from(await file.arrayBuffer());
    const up = await supabase.storage
      .from(CATEGORIAS_IMAGENES_BUCKET)
      .upload(path, buf, { contentType: file.type, upsert: true });
    if (up.error) {
      console.error("[categorias/imagen] upload", up.error.message);
      return NextResponse.json(
        errorResponse(`No se pudo subir la imagen: ${up.error.message}`),
        { status: 500 }
      );
    }

    const { data: pub } = supabase.storage
      .from(CATEGORIAS_IMAGENES_BUCKET)
      .getPublicUrl(path);
    // Append cache-bust por timestamp para que el navegador no muestre la
    // imagen vieja despues de un cambio (mismo path = mismo URL publica).
    const publicUrl = `${pub.publicUrl}?t=${Date.now()}`;

    const upd = await supabase
      .from("categorias_productos")
      .update({ imagen_url: publicUrl })
      .eq("empresa_id", empresaId)
      .eq("id", id)
      .select("id, imagen_url")
      .maybeSingle();
    if (upd.error) {
      console.error("[categorias/imagen] update row", upd.error.message);
      return NextResponse.json(
        errorResponse("Imagen subida pero no se pudo actualizar la categoría."),
        { status: 500 }
      );
    }

    return NextResponse.json(
      successResponse({ imagen_url: publicUrl })
    );
  } catch (err) {
    console.error(
      "[categorias/imagen POST] outer",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      errorResponse("No se pudo subir la imagen."),
      { status: 500 }
    );
  }
}
