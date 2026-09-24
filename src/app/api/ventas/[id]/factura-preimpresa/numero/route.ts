/**
 * POST /api/ventas/[id]/factura-preimpresa/numero
 * Body: { numero_secuencia: number }
 *
 * Edita manualmente el número de factura preimpresa de una venta (para mantener el
 * correlativo). Valida rango del timbrado y que no choque con otra factura.
 * Solo numeración: NO toca stock, caja ni los ítems/importes de la venta.
 */
import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { setNumeroFacturaAutoimpresor } from "@/lib/facturacion/autoimpresor/emitir-factura";

export async function POST(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id: ventaId } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json({ success: false, error: "No autenticado" }, { status: 401 });
    const empresaId = ctx.auth.empresa_id;

    const body = (await request.json().catch(() => ({}))) as { numero_secuencia?: unknown };
    const seq = Math.trunc(Number(body?.numero_secuencia));
    if (!Number.isFinite(seq) || seq <= 0) {
      return NextResponse.json({ success: false, error: "Número de factura inválido." }, { status: 400 });
    }

    const schema = await fetchDataSchemaForEmpresaId(empresaId);
    try {
      const factura = await setNumeroFacturaAutoimpresor(schema, empresaId, ventaId, seq);
      return NextResponse.json(
        { success: true, numero_completo: factura.numero_completo },
        { headers: { "Cache-Control": "no-store" } }
      );
    } catch (e) {
      // Errores de validación (rango, duplicado, sin factura) → mensaje claro para el usuario.
      return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "No se pudo editar el número." }, { status: 400 });
    }
  } catch (e) {
    console.error("[factura-preimpresa/numero]", e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, error: "Error interno." }, { status: 500 });
  }
}
