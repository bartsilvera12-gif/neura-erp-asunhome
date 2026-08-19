/**
 * Storage helpers para comprobantes/facturas de compra.
 *
 * Bucket: `compras-facturas` (privado).
 * Path:   `{empresa_id}/{uuid}.{ext}`  (independiente del numero_control, que
 *          se genera recién al guardar la compra; la referencia se replica
 *          luego en todas las filas del mismo numero_control).
 *
 * Aislamiento por tenant: el primer segmento del path es `empresa_id` y los
 * endpoints validan el `empresa_id` del usuario antes de leer/escribir.
 */
import type { AppSupabaseClient } from "@/lib/supabase/schema";

export const COMPRAS_FACTURAS_BUCKET = "compras-facturas";

// Facturas suelen venir como imagen o PDF.
export const ALLOWED_COMPROBANTE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};
export const MAX_COMPROBANTE_BYTES = 10 * 1024 * 1024; // 10 MB

let bucketEnsured = false;

/** Crea el bucket privado si no existe. Idempotente. */
export async function ensureComprasFacturasBucket(supabase: AppSupabaseClient): Promise<void> {
  if (bucketEnsured) return;
  try {
    const { data: existing } = await supabase.storage.getBucket(COMPRAS_FACTURAS_BUCKET);
    if (existing) { bucketEnsured = true; return; }
  } catch {
    // fallthrough — intentar crear
  }
  const { error: createErr } = await supabase.storage.createBucket(COMPRAS_FACTURAS_BUCKET, {
    public: false,
    fileSizeLimit: MAX_COMPROBANTE_BYTES,
    allowedMimeTypes: [...ALLOWED_COMPROBANTE_MIME],
  });
  if (createErr && !/already exists|duplicate/i.test(createErr.message)) {
    throw new Error(`No se pudo crear el bucket: ${createErr.message}`);
  }
  bucketEnsured = true;
}

/** Path nuevo para un comprobante de la empresa. `uuid` debe venir de crypto.randomUUID(). */
export function buildComprobantePath(empresaId: string, uuid: string, mime: string): string {
  const ext = EXT_BY_MIME[mime] ?? "bin";
  return `${empresaId}/${uuid}.${ext}`;
}

/** URL firmada para visualizar el comprobante. Null si el path es inválido o falla. */
export async function signComprobante(
  supabase: AppSupabaseClient,
  storagePath: string | null | undefined,
  ttlSeconds = 3600
): Promise<string | null> {
  if (!storagePath) return null;
  try {
    const { data, error } = await supabase.storage
      .from(COMPRAS_FACTURAS_BUCKET)
      .createSignedUrl(storagePath, ttlSeconds);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

/** Valida que el path pertenezca a la empresa (primer segmento). */
export function comprobantePathBelongsToEmpresa(path: string | null | undefined, empresaId: string): boolean {
  if (!path) return false;
  return path.split("/")[0] === empresaId;
}
