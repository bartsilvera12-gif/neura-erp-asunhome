import { NextRequest, NextResponse } from "next/server";
import { getSifenConfigSupabaseFromAuth } from "@/lib/sifen/sifen-config-service-client";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  buildKudeLogoObjectPath,
  ensureSifenStorageBucket,
  removeSifenObject,
  SIFEN_STORAGE_BUCKET,
  uploadKudeLogoPng,
} from "@/lib/sifen/sifen-storage";
import { toEmpresaSifenConfigPublicDto } from "@/lib/sifen/sifen-config-response";

/**
 * Tamaño máximo del PNG del logo KuDE. Suficientemente grande para un logo de
 * cabecera (≤ 1 MB); el renderer lo embebe en el PDF, no se sirve al navegador.
 */
const MAX_LOGO_BYTES = 1 * 1024 * 1024;

/** Magic bytes mínimos para PNG: 89 50 4E 47 0D 0A 1A 0A. */
function isPngBuffer(buf: Buffer): boolean {
  if (buf.length < 8) return false;
  return (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  );
}

/**
 * POST /api/configuracion/sifen/kude-logo
 * Sube un PNG (≤ 1 MB) al bucket privado `sifen` y guarda la ruta en
 * `empresa_sifen_config.kude_logo_path`. SOLO afecta KuDE/PDF: no toca XML,
 * firma, envío a SET, CDC, datos fiscales obligatorios ni certificado.
 *
 * Multipart: campo `file` (image/png).
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getSifenConfigSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size < 1) {
      return NextResponse.json(
        errorResponse("Se requiere el archivo PNG en el campo multipart `file`"),
        { status: 400 }
      );
    }
    if (file.size > MAX_LOGO_BYTES) {
      return NextResponse.json(
        errorResponse("El logo supera el tamaño máximo permitido (1 MB)"),
        { status: 400 }
      );
    }

    const tipo = String(file.type || "").toLowerCase();
    if (tipo && tipo !== "image/png") {
      return NextResponse.json(
        errorResponse("Solo se aceptan logos en formato PNG (Content-Type image/png)"),
        { status: 400 }
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    if (!isPngBuffer(buf)) {
      return NextResponse.json(
        errorResponse("El archivo no es un PNG válido (encabezado magic mismatch)"),
        { status: 400 }
      );
    }

    const { data: configRow, error: errCfg } = await supabase
      .from("empresa_sifen_config")
      .select("id")
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();

    if (errCfg) {
      return NextResponse.json(errorResponse(errCfg.message), { status: 400 });
    }
    if (!configRow) {
      return NextResponse.json(
        errorResponse(
          "No hay configuración SIFEN; cree la fila con POST /api/configuracion/sifen antes de subir el logo del KuDE"
        ),
        { status: 400 }
      );
    }

    const bucketOk = await ensureSifenStorageBucket(supabase);
    if (!bucketOk.ok) {
      return NextResponse.json(errorResponse(`Storage sifen: ${bucketOk.message}`), {
        status: 500,
      });
    }

    const objectPath = buildKudeLogoObjectPath(auth.empresa_id);
    const up = await uploadKudeLogoPng(supabase, objectPath, buf);
    if (!up.ok) {
      return NextResponse.json(errorResponse(`No se pudo subir el logo: ${up.message}`), {
        status: 500,
      });
    }

    const { data: updated, error: errUpd } = await supabase
      .from("empresa_sifen_config")
      .update({ kude_logo_path: objectPath })
      .eq("empresa_id", auth.empresa_id)
      .select()
      .single();

    if (errUpd || !updated) {
      await removeSifenObject(supabase, objectPath);
      return NextResponse.json(
        errorResponse(
          errUpd?.message ??
            "El archivo se subió pero no se pudo actualizar kude_logo_path; el objeto en storage fue eliminado."
        ),
        { status: 500 }
      );
    }

    return NextResponse.json(
      successResponse({
        config: toEmpresaSifenConfigPublicDto(updated as Record<string, unknown>),
        kude_logo_path: objectPath,
        storage_bucket: SIFEN_STORAGE_BUCKET,
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/**
 * DELETE /api/configuracion/sifen/kude-logo
 * Restaura el comportamiento por defecto (logo Neura) limpiando `kude_logo_path`
 * y eliminando el objeto del bucket. No toca XML/firma/SET/CDC.
 */
export async function DELETE(request: NextRequest) {
  try {
    const ctx = await getSifenConfigSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;

    const { data: existing, error: errSel } = await supabase
      .from("empresa_sifen_config")
      .select("id, kude_logo_path")
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();

    if (errSel) {
      return NextResponse.json(errorResponse(errSel.message), { status: 400 });
    }
    if (!existing) {
      return NextResponse.json(
        errorResponse("No hay configuración SIFEN para esta empresa"),
        { status: 404 }
      );
    }

    const prevPath =
      (existing as Record<string, unknown>).kude_logo_path == null
        ? null
        : String((existing as Record<string, unknown>).kude_logo_path).trim() || null;

    if (prevPath) {
      await removeSifenObject(supabase, prevPath);
    }

    const { data: updated, error: errUpd } = await supabase
      .from("empresa_sifen_config")
      .update({ kude_logo_path: null })
      .eq("empresa_id", auth.empresa_id)
      .select()
      .single();

    if (errUpd || !updated) {
      return NextResponse.json(
        errorResponse(errUpd?.message ?? "No se pudo limpiar kude_logo_path"),
        { status: 500 }
      );
    }

    return NextResponse.json(
      successResponse({
        config: toEmpresaSifenConfigPublicDto(updated as Record<string, unknown>),
        kude_logo_path: null,
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
