import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { incrementarSecuenciaPg } from "@/lib/inventario/server/productos-pg";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * POST /api/productos/codigo-barras
 *
 * Genera un código de barras REAL (EAN-13, 13 dígitos con dígito verificador
 * válido), escaneable y compatible con Code128/EAN. Prefijo 779 (GS1 Paraguay).
 * Usa la secuencia atómica por empresa para garantizar unicidad.
 *
 * Formato: 779 + 9 dígitos de secuencia + 1 dígito verificador = 13 dígitos.
 */

/** Dígito verificador EAN-13 sobre los primeros 12 dígitos. */
function ean13Check(d12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(d12[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const schema = await fetchDataSchemaForEmpresaId(empresaId);

    let seq: number;
    try {
      seq = await incrementarSecuenciaPg(schema, empresaId);
    } catch (err) {
      console.error("[/api/productos/codigo-barras] secuencia", err instanceof Error ? err.message : err);
      return NextResponse.json(errorResponse("No se pudo generar el código de barras."), { status: 500 });
    }
    if (!Number.isFinite(seq) || seq <= 0) {
      return NextResponse.json(errorResponse("No se pudo generar la secuencia."), { status: 500 });
    }

    // 779 (GS1 Paraguay) + secuencia a 9 dígitos = 12 dígitos; + verificador = 13.
    const base12 = "779" + String(seq).padStart(9, "0").slice(-9);
    const codigo = base12 + ean13Check(base12);

    return NextResponse.json(successResponse({ codigo, formato: "EAN-13" }));
  } catch (err) {
    console.error("[/api/productos/codigo-barras] outer", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo generar el código de barras."), { status: 500 });
  }
}
