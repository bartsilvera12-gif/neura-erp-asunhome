import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { handleNcSifenFirmarPost } from "@/lib/nota-credito/handle-nc-sifen-firmar-post";

/**
 * POST /api/notas-credito/[id]/sifen/firmar
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
    const debugXml = request.nextUrl.searchParams.get("debug") === "1";
    return handleNcSifenFirmarPost({
      auth: ctx.auth,
      supabase: ctx.supabase,
      notaCreditoId: nid,
      debugXml,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
