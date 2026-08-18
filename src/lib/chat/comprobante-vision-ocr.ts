/**
 * OCR vía Google Cloud Vision (API key). Solo servidor.
 */
export type VisionOcrResult = {
  fullText: string;
};

export async function runGoogleVisionDocumentOcr(imageBytes: Buffer): Promise<VisionOcrResult> {
  const key = process.env.GOOGLE_CLOUD_VISION_API_KEY?.trim();
  if (!key) {
    throw new Error("Falta GOOGLE_CLOUD_VISION_API_KEY en el entorno del servidor");
  }

  const b64 = imageBytes.toString("base64");
  const url = `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          image: { content: b64 },
          features: [{ type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 }],
        },
      ],
    }),
  });

  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const errObj = raw.error as { message?: string } | undefined;
    const msg = errObj?.message ?? res.statusText ?? "Vision API error";
    throw new Error(msg);
  }

  const responses = raw.responses as unknown[] | undefined;
  const first = responses?.[0] as Record<string, unknown> | undefined;
  const full =
    typeof first?.fullTextAnnotation === "object" && first.fullTextAnnotation !== null
      ? (first.fullTextAnnotation as { text?: string }).text
      : undefined;
  const text = typeof full === "string" ? full.trim() : "";

  if (!text && Array.isArray(first?.textAnnotations) && first.textAnnotations.length > 0) {
    const desc = (first.textAnnotations[0] as { description?: string })?.description;
    return { fullText: typeof desc === "string" ? desc.trim() : "" };
  }

  return { fullText: text };
}
