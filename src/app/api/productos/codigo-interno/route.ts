import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { incrementarSecuenciaPg } from "@/lib/inventario/server/productos-pg";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

export const INTERNAL_CODE_PREFIX = "INT-";

function empresaShort(nombre: string | null | undefined): string {
  const raw = (nombre ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
  const alnum = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return alnum.slice(0, 3) || "EMP";
}

function yyyymm(d = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}${m}`;
}

/**
 * POST /api/productos/codigo-interno
 *
 * Genera atomicamente un codigo interno unico por empresa via funcion
 * plpgsql instalada en cada schema tenant (UPSERT con ON CONFLICT DO UPDATE,
 * sin race conditions). Soporta tenants `erp_*` no expuestos en PostgREST.
 *
 * Formato: INT-{EMPRESA_SHORT}-{YYYYMM}-{SEQ6}
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const empresaId = ctx.auth.empresa_id;

    // Nombre de empresa para prefijo (catalogo zentra_erp.empresas).
    const catalog = createServiceRoleClient();
    const { data: emp } = await catalog
      .from("empresas")
      .select("nombre_empresa")
      .eq("id", empresaId)
      .maybeSingle();
    const short = empresaShort((emp as { nombre_empresa?: string | null } | null)?.nombre_empresa);

    const schema = await fetchDataSchemaForEmpresaId(empresaId);

    let nextValue: number;
    try {
      nextValue = await incrementarSecuenciaPg(schema, empresaId);
    } catch (err) {
      console.error("[/api/productos/codigo-interno]", {
        schema,
        empresaId,
        message: err instanceof Error ? err.message : String(err),
      });
      return NextResponse.json(
        errorResponse("No se pudo generar el código interno. Intentá nuevamente."),
        { status: 500 }
      );
    }

    if (!Number.isFinite(nextValue) || nextValue <= 0) {
      return NextResponse.json(
        errorResponse("No se pudo generar la secuencia."),
        { status: 500 }
      );
    }

    const seq6 = String(nextValue).padStart(6, "0");
    const codigo = `${INTERNAL_CODE_PREFIX}${short}-${yyyymm()}-${seq6}`;

    return NextResponse.json(successResponse({ codigo, interno: true }));
  } catch (err) {
    console.error("[/api/productos/codigo-interno] outer", err instanceof Error ? err.message : err);
    return NextResponse.json(
      errorResponse("No se pudo generar el código interno."),
      { status: 500 }
    );
  }
}
