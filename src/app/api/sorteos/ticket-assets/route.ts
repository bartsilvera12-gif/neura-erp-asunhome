import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  ensureTicketBucketsExist,
  SORTEO_TICKET_ASSETS_BUCKET,
  sorteoTicketAssetBackgroundCandidates,
  sorteoTicketAssetBackgroundPath,
  sorteoTicketAssetLogoCandidates,
  sorteoTicketAssetLogoPath,
  sorteoTicketAssetTemplateCandidates,
  sorteoTicketAssetTemplatePath,
} from "@/lib/sorteos/sorteo-ticket-storage";

const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

/**
 * POST multipart: sorteo_id, kind=logo|background|template, file
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const empresaId = ctx.auth.empresa_id;
    const form = await request.formData().catch(() => null);
    const sorteoId = typeof form?.get("sorteo_id") === "string" ? String(form.get("sorteo_id")).trim() : "";
    const kind = typeof form?.get("kind") === "string" ? String(form.get("kind")).trim() : "";
    const file = form?.get("file");
    if (!sorteoId || !(file instanceof File) || file.size < 1) {
      return NextResponse.json(errorResponse("sorteo_id y file son obligatorios"), { status: 400 });
    }
    if (kind !== "logo" && kind !== "background" && kind !== "template") {
      return NextResponse.json(errorResponse("kind debe ser logo, background o template"), { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(errorResponse("Archivo demasiado grande (máx. 4 MB)"), { status: 400 });
    }
    const mime = (file.type || "").toLowerCase();
    if (!ALLOWED.has(mime)) {
      return NextResponse.json(errorResponse("Solo PNG, JPG o WebP"), { status: 400 });
    }

    const sb = await getChatServiceClientForEmpresa(empresaId);
    const { data: sorteo, error: se } = await sb
      .from("sorteos")
      .select("id")
      .eq("id", sorteoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (se || !sorteo) {
      return NextResponse.json(errorResponse("Sorteo no encontrado"), { status: 404 });
    }

    await ensureTicketBucketsExist(sb);

    const buf = Buffer.from(await file.arrayBuffer());
    const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
    const objectPath =
      kind === "logo"
        ? sorteoTicketAssetLogoPath(empresaId, sorteoId).replace(/\.png$/, `.${ext}`)
        : kind === "background"
          ? sorteoTicketAssetBackgroundPath(empresaId, sorteoId).replace(/\.png$/, `.${ext}`)
          : sorteoTicketAssetTemplatePath(empresaId, sorteoId).replace(/\.png$/, `.${ext}`);

    const { error: upErr } = await sb.storage
      .from(SORTEO_TICKET_ASSETS_BUCKET)
      .upload(objectPath, buf, { contentType: mime, upsert: true });
    if (upErr) {
      return NextResponse.json(errorResponse(upErr.message), { status: 500 });
    }

    return NextResponse.json(
      successResponse({
        bucket: SORTEO_TICKET_ASSETS_BUCKET,
        path: objectPath,
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/**
 * DELETE ?sorteo_id=&kind=logo|background|template
 * Elimina todas las variantes de extensión del asset en el bucket (png/webp/jpg).
 */
export async function DELETE(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const empresaId = ctx.auth.empresa_id;
    const { searchParams } = new URL(request.url);
    const sorteoId = (searchParams.get("sorteo_id") ?? "").trim();
    const kind = (searchParams.get("kind") ?? "").trim();
    if (!sorteoId) {
      return NextResponse.json(errorResponse("sorteo_id es obligatorio"), { status: 400 });
    }
    if (kind !== "logo" && kind !== "background" && kind !== "template") {
      return NextResponse.json(errorResponse("kind debe ser logo, background o template"), { status: 400 });
    }

    const sb = await getChatServiceClientForEmpresa(empresaId);
    const { data: sorteo, error: se } = await sb
      .from("sorteos")
      .select("id")
      .eq("id", sorteoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (se || !sorteo) {
      return NextResponse.json(errorResponse("Sorteo no encontrado"), { status: 404 });
    }

    await ensureTicketBucketsExist(sb);

    const paths =
      kind === "logo"
        ? sorteoTicketAssetLogoCandidates(empresaId, sorteoId)
        : kind === "background"
          ? sorteoTicketAssetBackgroundCandidates(empresaId, sorteoId)
          : sorteoTicketAssetTemplateCandidates(empresaId, sorteoId);

    const { error: rmErr } = await sb.storage.from(SORTEO_TICKET_ASSETS_BUCKET).remove(paths);
    if (rmErr) {
      return NextResponse.json(errorResponse(rmErr.message), { status: 500 });
    }

    return NextResponse.json(successResponse({ removed: paths.length, kind }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
