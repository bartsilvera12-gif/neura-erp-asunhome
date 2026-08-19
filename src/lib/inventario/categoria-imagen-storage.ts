/**
 * Storage helpers para imagenes de categoria.
 *
 * Bucket: `categorias-imagenes` (PUBLICO — se sirve directo en el home del
 * sitio publico, por eso no usamos signed URLs).
 * Path:   `{empresa_id}/{categoria_id}.{ext}`
 */
import type { AppSupabaseClient } from "@/lib/supabase/schema";

export const CATEGORIAS_IMAGENES_BUCKET = "categorias-imagenes";

export const ALLOWED_CATEGORIA_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
export const ALLOWED_CATEGORIA_IMAGE_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export const MAX_CATEGORIA_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

let bucketEnsured = false;

export async function ensureCategoriasImagenesBucket(
  supabase: AppSupabaseClient
): Promise<void> {
  if (bucketEnsured) return;
  try {
    const { data: existing } = await supabase.storage.getBucket(
      CATEGORIAS_IMAGENES_BUCKET
    );
    if (existing) {
      bucketEnsured = true;
      return;
    }
  } catch {
    // fallthrough — intentar crear
  }
  const { error: createErr } = await supabase.storage.createBucket(
    CATEGORIAS_IMAGENES_BUCKET,
    {
      public: true,
      fileSizeLimit: MAX_CATEGORIA_IMAGE_BYTES,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    }
  );
  if (createErr && !/already exists|duplicate/i.test(createErr.message)) {
    throw new Error(`No se pudo crear el bucket: ${createErr.message}`);
  }
  bucketEnsured = true;
}

export function buildCategoriaImagenPath(
  empresaId: string,
  categoriaId: string,
  mime: string
): string {
  const ext = ALLOWED_CATEGORIA_IMAGE_EXT[mime] ?? "bin";
  // Sin subcarpeta — un archivo por categoria, sobreescribimos al cambiar.
  return `${empresaId}/${categoriaId}.${ext}`;
}
