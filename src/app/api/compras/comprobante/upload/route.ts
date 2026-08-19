import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  ALLOWED_COMPROBANTE_MIME,
  COMPRAS_FACTURAS_BUCKET,
  MAX_COMPROBANTE_BYTES,
  buildComprobantePath,
  ensureComprasFacturasBucket,
} from "@/lib/compras/comprobante-storage";

/**
 * POST /api/compras/comprobante/upload
 * Sube el comprobante (imagen/PDF) a `compras-facturas/{empresa}/{uuid}.ext`
 * ANTES de guardar la compra y devuelve la referencia para asociarla a todas
 * las filas del numero_control. No persiste nada en `compras` todavía.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase, auth } = ctx;
    const empresaId = auth.empresa_id;

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(errorResponse("Falta el archivo (campo 'file')."), { status: 400 });
    }
    if (!ALLOWED_COMPROBANTE_MIME.has(file.type)) {
      return NextResponse.json(
        errorResponse("Formato no permitido. Usá JPG, PNG, WebP o PDF."),
        { status: 400 }
      );
    }
    if (file.size > MAX_COMPROBANTE_BYTES) {
      const mb = (MAX_COMPROBANTE_BYTES / 1024 / 1024).toFixed(0);
      return NextResponse.json(errorResponse(`Archivo demasiado grande (máx. ${mb} MB).`), { status: 413 });
    }

    try {
      await ensureComprasFacturasBucket(supabase);
    } catch (bucketErr) {
      console.error("[compras/comprobante/upload] ensureBucket", bucketErr instanceof Error ? bucketErr.message : bucketErr);
      // Continuar: si el bucket ya existe pero el ensure falla por permisos, el upload puede andar igual.
    }

    const path = buildComprobantePath(empresaId, randomUUID(), file.type);
    const buf = Buffer.from(await file.arrayBuffer());
    const up = await supabase.storage
      .from(COMPRAS_FACTURAS_BUCKET)
      .upload(path, buf, { contentType: file.type, upsert: false });
    if (up.error) {
      console.error("[compras/comprobante/upload] upload", { empresaId, message: up.error.message });
      return NextResponse.json(errorResponse(`No se pudo subir el comprobante: ${up.error.message}`), { status: 500 });
    }

    return NextResponse.json(successResponse({
      comprobante_storage_path: path,
      comprobante_nombre: (file.name || "comprobante").slice(0, 200),
      comprobante_mime_type: file.type,
    }));
  } catch (err) {
    console.error("[compras/comprobante/upload] outer", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo subir el comprobante."), { status: 500 });
  }
}
