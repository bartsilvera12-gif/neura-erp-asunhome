import { NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { isExplicitSifenTestOverrideEnabled } from "@/lib/env/allow-test-mode";

/**
 * GET /api/config/allow-test-mode
 * Indica si el servidor permite endpoints SIFEN `*-test` con configuración en producción (ALLOW_TEST_MODE).
 */
export async function GET(req: Request) {
  const ctx = await getTenantSupabaseFromAuth(req);
  if (!ctx) {
    return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
  }
  const { auth, supabase } = ctx;
  const { data: cfg } = await supabase
    .from("empresa_sifen_config")
    .select("ambiente")
    .eq("empresa_id", auth.empresa_id)
    .maybeSingle();
  const raw = String((cfg as { ambiente?: string } | null)?.ambiente ?? "").trim().toLowerCase();
  const empresaSifenAmbiente = raw === "produccion" ? "produccion" : "test";

  return NextResponse.json(
    successResponse({
      allowSifenTestOverride: isExplicitSifenTestOverrideEnabled(),
      empresa_sifen_ambiente: empresaSifenAmbiente,
    })
  );
}
