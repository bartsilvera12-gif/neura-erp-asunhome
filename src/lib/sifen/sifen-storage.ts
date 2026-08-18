import type { AppSupabaseClient } from "@/lib/supabase/schema";

/** Bucket dedicado a archivos SIFEN (XML, luego PDF/KUDE si aplica). */
export const SIFEN_STORAGE_BUCKET = "sifen";

/**
 * Ruta del objeto dentro del bucket: `{empresa_id}/{factura_id}/documento.xml`
 * (coincide con el patrón solicitado bajo el prefijo del bucket `sifen`).
 */
export function buildSifenXmlObjectPath(empresaId: string, facturaId: string): string {
  return `${empresaId}/${facturaId}/documento.xml`;
}

/** XML firmado (XML-DSig) en el mismo bucket `sifen`. */
export function buildSifenSignedXmlObjectPath(empresaId: string, facturaId: string): string {
  return `${empresaId}/${facturaId}/documento-firmado.xml`;
}

/** XML rDE nota de crédito (sin firma). */
export function buildSifenNcXmlObjectPath(empresaId: string, notaCreditoId: string): string {
  return `${empresaId}/nc/${notaCreditoId}/documento.xml`;
}

export function buildSifenNcSignedXmlObjectPath(empresaId: string, notaCreditoId: string): string {
  return `${empresaId}/nc/${notaCreditoId}/documento-firmado.xml`;
}

/**
 * Logo de marca usado SOLO para representación gráfica KuDE/PDF.
 * No participa de XML/firma/SET/CDC. Privado, leído server-side por el renderer.
 */
export function buildKudeLogoObjectPath(empresaId: string): string {
  return `${empresaId}/branding/kude-logo.png`;
}

export async function ensureSifenStorageBucket(supabase: AppSupabaseClient): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) {
    return { ok: false, message: listErr.message };
  }
  if ((buckets ?? []).some((b) => b.name === SIFEN_STORAGE_BUCKET)) {
    return { ok: true };
  }
  const { error: createErr } = await supabase.storage.createBucket(SIFEN_STORAGE_BUCKET, {
    public: false,
    fileSizeLimit: "10MB",
  });
  if (createErr && !createErr.message.toLowerCase().includes("already exists")) {
    return { ok: false, message: createErr.message };
  }
  return { ok: true };
}

export async function uploadSifenXml(
  supabase: AppSupabaseClient,
  objectPath: string,
  xml: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const buf = Buffer.from(xml, "utf8");
  const { error } = await supabase.storage.from(SIFEN_STORAGE_BUCKET).upload(objectPath, buf, {
    contentType: "application/xml; charset=utf-8",
    upsert: true,
  });
  if (error) {
    return { ok: false, message: error.message };
  }
  return { ok: true };
}

export async function removeSifenObject(
  supabase: AppSupabaseClient,
  objectPath: string
): Promise<void> {
  await supabase.storage.from(SIFEN_STORAGE_BUCKET).remove([objectPath]);
}

export async function downloadSifenObject(
  supabase: AppSupabaseClient,
  objectPath: string
): Promise<{ ok: true; data: Buffer } | { ok: false; message: string }> {
  const { data, error } = await supabase.storage.from(SIFEN_STORAGE_BUCKET).download(objectPath);
  if (error || !data) {
    return { ok: false, message: error?.message ?? "Objeto no encontrado en storage" };
  }
  const ab = await data.arrayBuffer();
  return { ok: true, data: Buffer.from(ab) };
}

/** Sube el logo PNG del KuDE al bucket privado `sifen`. */
export async function uploadKudeLogoPng(
  supabase: AppSupabaseClient,
  objectPath: string,
  bytes: Buffer
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.storage.from(SIFEN_STORAGE_BUCKET).upload(objectPath, bytes, {
    contentType: "image/png",
    upsert: true,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}
