import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { signComprobante, comprobantePathBelongsToEmpresa } from "@/lib/compras/comprobante-storage";

/**
 * GET /api/compras/comprobante?numero_control=COMP-000005
 * Resuelve el comprobante de una compra (agrupada por numero_control), valida
 * pertenencia a la empresa, firma una URL temporal y redirige a ella.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase, auth } = ctx;
    const empresaId = auth.empresa_id;

    const numero = new URL(request.url).searchParams.get("numero_control")?.trim();
    if (!numero) return NextResponse.json(errorResponse("Falta numero_control."), { status: 400 });

    const { data, error } = await supabase
      .from("compras")
      .select("comprobante_storage_path")
      .eq("empresa_id", empresaId)
      .eq("numero_control", numero)
      .not("comprobante_storage_path", "is", null)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[compras/comprobante GET]", error.message);
      return NextResponse.json(errorResponse("No se pudo resolver el comprobante."), { status: 500 });
    }
    const path = (data as { comprobante_storage_path?: string | null } | null)?.comprobante_storage_path ?? null;
    if (!path) return NextResponse.json(errorResponse("Esta compra no tiene comprobante."), { status: 404 });
    if (!comprobantePathBelongsToEmpresa(path, empresaId)) {
      return NextResponse.json(errorResponse("No autorizado."), { status: 403 });
    }

    const signed = await signComprobante(supabase, path, 3600);
    if (!signed) return NextResponse.json(errorResponse("No se pudo generar el enlace del comprobante."), { status: 500 });

    return NextResponse.redirect(signed, { status: 302 });
  } catch (err) {
    console.error("[compras/comprobante GET] outer", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo abrir el comprobante."), { status: 500 });
  }
}
