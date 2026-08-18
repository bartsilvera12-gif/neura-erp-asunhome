import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { handleNcSifenProcesarPost } from "@/lib/nota-credito/handle-nc-sifen-procesar-post";

/**
 * POST /api/notas-credito/[id]/sifen/procesar — xml + firmar + enviar (producción).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { id } = await params;
    const nid = id?.trim() ?? "";
    if (!nid) {
      return NextResponse.json(errorResponse("id de nota de crédito es obligatorio"), { status: 400 });
    }
    return handleNcSifenProcesarPost({
      request,
      auth: ctx.auth,
      supabase: ctx.supabase,
      notaCreditoId: nid,
      options: { soloAmbienteTest: false },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
