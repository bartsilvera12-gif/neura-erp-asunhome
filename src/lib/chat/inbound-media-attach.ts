import { downloadMetaMediaBytes } from "@/lib/chat/meta-media-download";
import type { MetaInboundMessage, SupabaseAdmin } from "@/lib/chat/types";

const CHAT_MEDIA_BUCKET = "chat-media";

let bucketEnsured = false;

async function ensureChatMediaBucket(supabase: SupabaseAdmin): Promise<void> {
  if (bucketEnsured) return;
  const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) throw new Error(listErr.message);
  const exists = (buckets ?? []).some((b) => b.name === CHAT_MEDIA_BUCKET);
  if (!exists) {
    const { error: createErr } = await supabase.storage.createBucket(CHAT_MEDIA_BUCKET, {
      public: true,
      fileSizeLimit: "15MB",
    });
    if (createErr && !createErr.message.toLowerCase().includes("already exists")) {
      throw new Error(createErr.message);
    }
  }
  bucketEnsured = true;
}

function extensionFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("pdf")) return "pdf";
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("gif")) return "gif";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("mp4")) return "mp4";
  if (m.includes("quicktime") || m.includes("mov")) return "mov";
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("aac") || m.includes("m4a")) return "m4a";
  if (m.includes("wav")) return "wav";
  if (m.includes("webm")) return "webm";
  return "bin";
}

export type InboundPreviewMedia = {
  mediaId: string;
  mimeType: string | null;
  filename: string | null;
  sourceType: "image" | "document" | "sticker" | "video" | "audio";
};

export function extractInboundPreviewMedia(msg: MetaInboundMessage): InboundPreviewMedia | null {
  const t = (msg.type ?? "").trim();
  if (t === "image") {
    const mediaId = msg.image?.id?.trim();
    if (!mediaId) return null;
    return {
      mediaId,
      mimeType: msg.image?.mime_type?.trim() || null,
      filename: null,
      sourceType: "image",
    };
  }
  if (t === "document") {
    const doc = msg.document;
    const mediaId = doc?.id?.trim();
    if (!mediaId) return null;
    return {
      mediaId,
      mimeType: doc?.mime_type?.trim() || null,
      filename: doc?.filename?.trim() || null,
      sourceType: "document",
    };
  }
  if (t === "sticker") {
    const mediaId = msg.sticker?.id?.trim();
    if (!mediaId) return null;
    return {
      mediaId,
      mimeType: null,
      filename: null,
      sourceType: "sticker",
    };
  }
  if (t === "video") {
    const mediaId = msg.video && typeof msg.video === "object" ? (msg.video as { id?: string }).id?.trim() : "";
    if (!mediaId) return null;
    return {
      mediaId,
      mimeType:
        msg.video && typeof msg.video === "object"
          ? (msg.video as { mime_type?: string }).mime_type?.trim() || null
          : null,
      filename: null,
      sourceType: "video",
    };
  }
  if (t === "audio") {
    const mediaId = msg.audio?.id?.trim();
    if (!mediaId) return null;
    return {
      mediaId,
      mimeType: msg.audio?.mime_type?.trim() || null,
      filename: null,
      sourceType: "audio",
    };
  }
  return null;
}

/**
 * Descarga media entrante de Meta, sube a Storage público y guarda URL en `raw_payload.erp`.
 */
export async function attachInboundMessageMedia(params: {
  supabase: SupabaseAdmin;
  empresaId: string;
  conversationId: string;
  messageId: string;
  msg: MetaInboundMessage;
  accessToken: string;
}): Promise<void> {
  const spec = extractInboundPreviewMedia(params.msg);
  if (!spec) return;

  await ensureChatMediaBucket(params.supabase);

  const { bytes, mimeType } = await downloadMetaMediaBytes({
    mediaId: spec.mediaId,
    accessToken: params.accessToken,
    mimeTypeHint: spec.mimeType,
  });

  const ext = extensionFromMime(mimeType);
  const path = `${params.empresaId}/${params.conversationId}/${params.messageId}.${ext}`;

  const { error: upErr } = await params.supabase.storage
    .from(CHAT_MEDIA_BUCKET)
    .upload(path, bytes, { contentType: mimeType, upsert: true });

  if (upErr) {
    console.warn("[inbound-media-attach] upload failed", upErr.message);
    return;
  }

  const { data: pub } = params.supabase.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(path);
  const publicUrl = pub?.publicUrl;
  if (!publicUrl) return;

  const { data: row } = await params.supabase
    .from("chat_messages")
    .select("raw_payload")
    .eq("id", params.messageId)
    .maybeSingle();

  const prev =
    row?.raw_payload && typeof row.raw_payload === "object" && !Array.isArray(row.raw_payload)
      ? (row.raw_payload as Record<string, unknown>)
      : {};

  const erp = {
    public_url: publicUrl,
    storage_path: path,
    mime_type: mimeType,
    filename: spec.filename,
    source_type: spec.sourceType,
  };

  await params.supabase
    .from("chat_messages")
    .update({
      raw_payload: { ...prev, erp } as unknown as Record<string, unknown>,
    })
    .eq("id", params.messageId);
}
