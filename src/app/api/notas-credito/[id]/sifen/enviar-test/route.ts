import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { handleNcSifenEnviarPost } from "@/lib/nota-credito/handle-nc-sifen-enviar-post";

/**
 * POST /api/notas-credito/[id]/sifen/enviar-test
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { id } = await params;
    const nid = id?.trim() ?? "";
    if (!nid) {
      return NextResponse.json(errorResponse("id de nota de crédito es obligatorio"), { status: 400 });
    }
    const debugSoap = request.nextUrl.searchParams.get("debug") === "1";
    return handleNcSifenEnviarPost(ctx.supabase, ctx.auth, nid, { soloAmbienteTest: true }, debugSoap);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
