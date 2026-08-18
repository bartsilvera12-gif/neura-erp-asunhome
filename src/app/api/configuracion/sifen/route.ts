import { NextRequest, NextResponse } from "next/server";
import { getSifenConfigSupabaseFromAuth } from "@/lib/sifen/sifen-config-service-client";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  buildPatchUpdate,
  rowFromCreateBody,
  validateCreateBody,
} from "@/lib/sifen/config-validation";
import { mergeCertificadoPasswordEncryptedForInsert } from "@/lib/sifen/sifen-config-persist";
import { toEmpresaSifenConfigPublicDto } from "@/lib/sifen/sifen-config-response";
import { encryptSecret } from "@/lib/sifen/security";


/**
 * GET /api/configuracion/sifen
 * Configuración SIFEN de la empresa autenticada; data null si aún no existe.
 * No expone contraseña ni ciphertext.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getSifenConfigSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;

    const { data, error } = await supabase
      .from("empresa_sifen_config")
      .select("*")
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }

    return NextResponse.json(successResponse(toEmpresaSifenConfigPublicDto(data as Record<string, unknown> | null)));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/**
 * POST /api/configuracion/sifen
 * Crea la configuración si no existe (una por empresa).
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getSifenConfigSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(errorResponse("Cuerpo JSON inválido"), { status: 400 });
    }

    const validated = validateCreateBody(body);
    if (!validated.ok) {
      return NextResponse.json(errorResponse(validated.error), { status: 400 });
    }


    const { data: existing } = await supabase
      .from("empresa_sifen_config")
      .select("id")
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        errorResponse("Ya existe configuración SIFEN para esta empresa; use PATCH para actualizar"),
        { status: 409 }
      );
    }

    const insert = rowFromCreateBody(auth.empresa_id, validated.data);
    try {
      mergeCertificadoPasswordEncryptedForInsert(insert, validated.data.certificado_password);
    } catch (e) {
      const m = e instanceof Error ? e.message : "Error al cifrar la contraseña del certificado";
      return NextResponse.json(errorResponse(m), { status: 500 });
    }

    const { data, error } = await supabase
      .from("empresa_sifen_config")
      .insert(insert)
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          errorResponse("Ya existe configuración SIFEN para esta empresa; use PATCH para actualizar"),
          { status: 409 }
        );
      }
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }

    return NextResponse.json(successResponse(toEmpresaSifenConfigPublicDto(data as Record<string, unknown>)));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/**
 * PATCH /api/configuracion/sifen
 * Actualiza la configuración existente de la empresa autenticada.
 */
export async function PATCH(request: NextRequest) {
  try {
    const ctx = await getSifenConfigSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(errorResponse("Cuerpo JSON inválido"), { status: 400 });
    }

    const built = buildPatchUpdate(body);
    if (!built.ok) {
      return NextResponse.json(errorResponse(built.error), { status: 400 });
    }


    const { data: existing, error: errLoad } = await supabase
      .from("empresa_sifen_config")
      .select("id")
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();

    if (errLoad) {
      return NextResponse.json(errorResponse(errLoad.message), { status: 400 });
    }

    if (!existing) {
      return NextResponse.json(
        errorResponse("No hay configuración SIFEN; use POST para crearla"),
        { status: 404 }
      );
    }

    const finalPatch: Record<string, unknown> = { ...built.patch };
    if (built.password.kind === "clear") {
      finalPatch.certificado_password_encrypted = null;
    } else if (built.password.kind === "set") {
      try {
        finalPatch.certificado_password_encrypted = encryptSecret(built.password.value);
      } catch (e) {
        const m = e instanceof Error ? e.message : "Error al cifrar la contraseña del certificado";
        return NextResponse.json(errorResponse(m), { status: 500 });
      }
    }

    const { data, error } = await supabase
      .from("empresa_sifen_config")
      .update(finalPatch)
      .eq("empresa_id", auth.empresa_id)
      .select()
      .single();

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }

    return NextResponse.json(successResponse(toEmpresaSifenConfigPublicDto(data as Record<string, unknown>)));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
