import { NextRequest, NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { fetchObligacionesCatalogo } from "@/lib/clientes/tributario-server";
import { getGestionTributariaClientes } from "@/lib/empresa/gestion-tributaria-catalog";

/**
 * Catálogo de obligaciones (solo si la empresa tiene activa la gestión tributaria).
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;
    const on = await getGestionTributariaClientes(auth.empresa_id);
    if (!on) {
      return NextResponse.json(errorResponse("La gestión tributaria de clientes no está activa"), { status: 403 });
    }
    const items = await fetchObligacionesCatalogo(supabase);
    return NextResponse.json(successResponse({ items }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
