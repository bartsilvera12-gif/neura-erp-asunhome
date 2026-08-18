/**
 * Descarga binario desde Meta Graph (media id → URL temporal → bytes).
 * Usado por flujo de comprobantes y por adjuntos de vista previa en el ERP.
 */
export async function downloadMetaMediaBytes(params: {
  mediaId: string;
  accessToken: string;
  mimeTypeHint?: string | null;
  graphVersion?: string;
}): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const version = params.graphVersion ?? process.env.WHATSAPP_GRAPH_VERSION ?? "v19.0";
  const metaRes = await fetch(`https://graph.facebook.com/${version}/${params.mediaId}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });
  const metaJson = (await metaRes.json().catch(() => ({}))) as {
    url?: string;
    mime_type?: string;
    error?: { message?: string };
  };
  if (!metaRes.ok || !metaJson.url) {
    throw new Error(
      metaJson.error?.message || `No se pudo obtener URL temporal para media_id=${params.mediaId}`
    );
  }

  const binRes = await fetch(metaJson.url, {
    method: "GET",
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });
  if (!binRes.ok) {
    throw new Error(`No se pudo descargar binario media_id=${params.mediaId}`);
  }
  const arr = new Uint8Array(await binRes.arrayBuffer());
  return { bytes: arr, mimeType: metaJson.mime_type || params.mimeTypeHint || "application/octet-stream" };
}
