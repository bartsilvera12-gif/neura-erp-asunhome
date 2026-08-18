import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { evaluarPrevueloNotaCreditoCompleto } from "@/lib/nota-credito/pre-vuelo-nc-sifen";
import { isExplicitSifenTestOverrideEnabled } from "@/lib/env/allow-test-mode";

/**
 * GET /api/notas-credito/[id]/sifen/prevuelo — diagnóstico interno (timbrado / CDC / XML) sin enviar a SET.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;
    const { id } = await params;
    const nid = id?.trim();
    if (!nid) {
      return NextResponse.json(errorResponse("id de nota de crédito es obligatorio"), { status: 400 });
    }

    const forzarTest =
      request.nextUrl.searchParams.get("test") === "1" && isExplicitSifenTestOverrideEnabled();

    const r = await evaluarPrevueloNotaCreditoCompleto(supabase, auth.empresa_id, nid, {
      ambienteDeXml: forzarTest ? "test" : undefined,
    });

    return NextResponse.json(successResponse(r));
  } catch (e) {
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "Error interno"),
      { status: 500 }
    );
  }
}
