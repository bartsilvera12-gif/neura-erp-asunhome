import { NextRequest, NextResponse } from "next/server";
import { getSifenConfigSupabaseFromAuth } from "@/lib/sifen/sifen-config-service-client";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  buildSifenCertificadoObjectPath,
  ensureSifenCertificadosBucket,
  removeSifenCertificadoObject,
  SIFEN_CERTIFICADOS_BUCKET,
  uploadSifenCertificadoP12,
} from "@/lib/sifen/sifen-certificados-storage";
import { toEmpresaSifenConfigPublicDto } from "@/lib/sifen/sifen-config-response";

const MAX_BYTES = 5 * 1024 * 1024;


/**
 * POST /api/configuracion/sifen/certificado
 * Sube el .p12 al bucket privado `sifen-certificados` y actualiza `certificado_path`.
 * Multipart: campo `file` (application/x-pkcs12 o octet-stream).
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
      return NextResponse.json(errorResponse("Se requiere el archivo en el campo multipart `file`"), {
        status: 400,
      });
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(errorResponse("El certificado supera el tamaño máximo permitido (5 MB)"), {
        status: 400,
      });
    }


    const { data: configRow, error: errCfg } = await supabase
      .from("empresa_sifen_config")
      .select("*")
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();

    if (errCfg) {
      return NextResponse.json(errorResponse(errCfg.message), { status: 400 });
    }
    if (!configRow) {
      return NextResponse.json(
        errorResponse("No hay configuración SIFEN; cree la fila con POST /api/configuracion/sifen antes de subir el certificado"),
        { status: 400 }
      );
    }

    const bucketOk = await ensureSifenCertificadosBucket(supabase);
    if (!bucketOk.ok) {
      return NextResponse.json(errorResponse(`Storage certificados: ${bucketOk.message}`), {
        status: 500,
      });
    }

    const objectPath = buildSifenCertificadoObjectPath(auth.empresa_id);
    const buf = Buffer.from(await file.arrayBuffer());

    const up = await uploadSifenCertificadoP12(supabase, objectPath, buf);
    if (!up.ok) {
      return NextResponse.json(errorResponse(`No se pudo subir el certificado: ${up.message}`), {
        status: 500,
      });
    }

    const { data: updated, error: errUpd } = await supabase
      .from("empresa_sifen_config")
      .update({ certificado_path: objectPath })
      .eq("empresa_id", auth.empresa_id)
      .select()
      .single();

    if (errUpd || !updated) {
      await removeSifenCertificadoObject(supabase, objectPath);
      return NextResponse.json(
        errorResponse(
          errUpd?.message ??
            "El archivo se subió pero no se pudo actualizar certificado_path; el objeto en storage fue eliminado."
        ),
        { status: 500 }
      );
    }

    return NextResponse.json(
      successResponse({
        config: toEmpresaSifenConfigPublicDto(updated as Record<string, unknown>),
        certificado_path: objectPath,
        storage_bucket: SIFEN_CERTIFICADOS_BUCKET,
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
