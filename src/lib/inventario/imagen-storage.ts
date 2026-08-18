/**
 * Storage helpers para imagenes de producto.
 *
 * Bucket: `productos-imagenes` (privado).
 * Path:   `{empresa_id}/{producto_id}/principal.{ext}`
 *
 * Aislamiento por tenant: el primer segmento del path es `empresa_id` y los
 * endpoints siempre validan el `empresa_id` del usuario antes de leer/escribir.
 */
import type { AppSupabaseClient } from "@/lib/supabase/schema";

export const PRODUCTOS_IMAGENES_BUCKET = "productos-imagenes";

export const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
export const ALLOWED_IMAGE_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

let bucketEnsured = false;

/**
 * Crea el bucket privado si no existe. Idempotente. Cachea el flag en memoria
 * del proceso para no llamar listBuckets en cada request.
 *
 * Requiere un cliente con service role (puede ser el del tenant ya que las
 * operaciones de storage usan la misma key).
 */
export async function ensureProductosImagenesBucket(supabase: AppSupabaseClient): Promise<void> {
  if (bucketEnsured) return;
  try {
    const { data: existing } = await supabase.storage.getBucket(PRODUCTOS_IMAGENES_BUCKET);
    if (existing) {
      bucketEnsured = true;
      return;
    }
  } catch {
    // fallthrough — intentar crear
  }
  const { error: createErr } = await supabase.storage.createBucket(PRODUCTOS_IMAGENES_BUCKET, {
    public: false,
    fileSizeLimit: MAX_IMAGE_BYTES,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  });
  if (createErr && !/already exists|duplicate/i.test(createErr.message)) {
    throw new Error(`No se pudo crear el bucket: ${createErr.message}`);
  }
  bucketEnsured = true;
}

export function buildProductoImagenPath(empresaId: string, productoId: string, mime: string): string {
  const ext = ALLOWED_IMAGE_EXT[mime] ?? "bin";
  return `${empresaId}/${productoId}/principal.${ext}`;
}

/**
 * Genera URL firmada para visualizar la imagen. TTL por defecto 1h.
 * Devuelve null si el path es inválido o si falla.
 */
export async function signProductoImagen(
  supabase: AppSupabaseClient,
  imagenPath: string | null | undefined,
  ttlSeconds = 3600
): Promise<string | null> {
  if (!imagenPath) return null;
  try {
    const { data, error } = await supabase.storage
      .from(PRODUCTOS_IMAGENES_BUCKET)
      .createSignedUrl(imagenPath, ttlSeconds);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

/**
 * Valida que el path pertenezca a la empresa indicada (primer segmento).
 * Previene cross-tenant en operaciones que reciben paths arbitrarios.
 */
export function pathBelongsToEmpresa(path: string | null | undefined, empresaId: string): boolean {
  if (!path) return false;
  const seg = path.split("/")[0];
  return seg === empresaId;
}
