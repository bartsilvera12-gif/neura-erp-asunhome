import { NextRequest, NextResponse } from "next/server";
import { getAuthWithRol } from "@/lib/middleware/auth";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

const CHAT_MEDIA_BUCKET = "chat-media";

async function ensureBucket(supabase: AppSupabaseClient) {
  const { data, error } = await supabase.storage.listBuckets();
  if (error) throw new Error(error.message);
  const exists = (data ?? []).some((b) => b.name === CHAT_MEDIA_BUCKET);
  if (exists) return;
  const { error: createErr } = await supabase.storage.createBucket(CHAT_MEDIA_BUCKET, {
    public: true,
    fileSizeLimit: "10MB",
  });
  if (createErr && !createErr.message.toLowerCase().includes("already exists")) {
    throw new Error(createErr.message);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthWithRol(request);
    if (!auth?.empresa_id) {
      return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Archivo requerido" }, { status: 400 });
    }
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ ok: false, error: "Solo se permiten imágenes" }, { status: 400 });
    }
    const ext = file.name.includes(".") ? file.name.split(".").pop() : "jpg";
    const path = `${auth.empresa_id}/flow-editor/${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const supabase = await getChatServiceClientForEmpresa(auth.empresa_id);
    await ensureBucket(supabase);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const up = await supabase.storage.from(CHAT_MEDIA_BUCKET).upload(path, bytes, {
      contentType: file.type,
      upsert: true,
    });
    if (up.error) {
      return NextResponse.json({ ok: false, error: up.error.message }, { status: 400 });
    }
    const mediaUrl = supabase.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
    return NextResponse.json({ ok: true, media_url: mediaUrl, path });
  } catch (e) {
    console.error("[api/chat/flow-media/upload][POST]", e);
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}
