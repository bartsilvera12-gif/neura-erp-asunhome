import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Bucket privado para archivos .p12 (separado del bucket `sifen` usado para XML).
 * Ruta objeto: `{empresa_id}/certificado.p12`
 */
export const SIFEN_CERTIFICADOS_BUCKET = "sifen-certificados";

export function buildSifenCertificadoObjectPath(empresaId: string): string {
  return `${empresaId}/certificado.p12`;
}

export async function ensureSifenCertificadosBucket(
  supabase: AppSupabaseClient
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) {
    return { ok: false, message: listErr.message };
  }
  if ((buckets ?? []).some((b) => b.name === SIFEN_CERTIFICADOS_BUCKET)) {
    return { ok: true };
  }
  const { error: createErr } = await supabase.storage.createBucket(SIFEN_CERTIFICADOS_BUCKET, {
    public: false,
    fileSizeLimit: "5MB",
  });
  if (createErr && !createErr.message.toLowerCase().includes("already exists")) {
    return { ok: false, message: createErr.message };
  }
  return { ok: true };
}

export async function uploadSifenCertificadoP12(
  supabase: AppSupabaseClient,
  objectPath: string,
  bytes: Buffer
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.storage.from(SIFEN_CERTIFICADOS_BUCKET).upload(objectPath, bytes, {
    contentType: "application/x-pkcs12",
    upsert: true,
  });
  if (error) {
    return { ok: false, message: error.message };
  }
  return { ok: true };
}

export async function removeSifenCertificadoObject(
  supabase: AppSupabaseClient,
  objectPath: string
): Promise<void> {
  await supabase.storage.from(SIFEN_CERTIFICADOS_BUCKET).remove([objectPath]);
}

export async function downloadSifenCertificadoObject(
  supabase: AppSupabaseClient,
  objectPath: string
): Promise<{ ok: true; data: Buffer } | { ok: false; message: string }> {
  const { data, error } = await supabase.storage.from(SIFEN_CERTIFICADOS_BUCKET).download(objectPath);
  if (error || !data) {
    return { ok: false, message: error?.message ?? "Certificado no encontrado en storage" };
  }
  const ab = await data.arrayBuffer();
  return { ok: true, data: Buffer.from(ab) };
}
