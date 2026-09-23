/**
 * POST /api/ventas/[id]/factura-preimpresa/rehacer
 *
 * "La factura salió mal → reimprimir en hoja nueva": salta (anula) el número de
 * factura preimpresa actual de la venta y le asigna el SIGUIENTE del talonario,
 * para que el sistema quede alineado con la hoja física nueva. El número anterior
 * queda como salto en el correlativo (la hoja física se archiva anulada, en papel).
 *
 * Solo numeración: NO toca stock, caja ni los ítems/importes de la venta.
 */
import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import {
  reimprimirFacturaEnNuevaHoja,
  EmisionBloqueadaError,
} from "@/lib/facturacion/autoimpresor/emitir-factura";

export async function POST(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id: ventaId } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json({ success: false, error: "No autenticado" }, { status: 401 });
    const empresaId = ctx.auth.empresa_id;

    const schema = await fetchDataSchemaForEmpresaId(empresaId);
    const factura = await reimprimirFacturaEnNuevaHoja(schema, empresaId, ventaId);

    return NextResponse.json(
      { success: true, numero_completo: factura.numero_completo },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    if (e instanceof EmisionBloqueadaError) {
      return NextResponse.json({ success: false, error: e.message, motivo: e.motivo }, { status: 409 });
    }
    console.error("[factura-preimpresa/rehacer]", e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, error: "No se pudo reimprimir en hoja nueva." }, { status: 500 });
  }
}
