/**
 * POST /api/compras/convertir — convierte una factura provisoria en definitiva
 * (completa datos de factura) y genera la cuenta por pagar + cuotas automáticas
 * según la gracia y los plazos configurados del proveedor.
 *
 * Body: { numero_control, numero_factura, nro_timbrado?, fecha_factura (YYYY-MM-DD) }
 */
import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { convertirProvisoriaEnDefinitiva } from "@/lib/cuentas-por-pagar/server/cxp-pg";

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);

    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const numeroControl = b.numero_control != null ? String(b.numero_control).trim() : "";
    const numeroFactura = b.numero_factura != null ? String(b.numero_factura).trim() : "";
    const fechaFactura = b.fecha_factura != null ? String(b.fecha_factura).trim().slice(0, 10) : "";
    const nroTimbrado = b.nro_timbrado != null ? String(b.nro_timbrado).trim().toUpperCase() : null;

    if (!numeroControl) return NextResponse.json(errorResponse("Falta numero_control."), { status: 400 });
    if (!numeroFactura) return NextResponse.json(errorResponse("Falta el N° de factura."), { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaFactura))
      return NextResponse.json(errorResponse("Falta la fecha de factura (YYYY-MM-DD)."), { status: 400 });

    const resumen = await convertirProvisoriaEnDefinitiva(schema, ctx.auth.empresa_id, {
      numeroControl,
      numeroFactura,
      nroTimbrado,
      fechaFactura,
    });
    return NextResponse.json(successResponse({ cuenta: resumen }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo convertir la provisoria.";
    console.error("[/api/compras/convertir POST]", msg);
    const status = /no se encontró|no está en estado|obligatorio|inválida/i.test(msg) ? 400 : 500;
    return NextResponse.json(errorResponse(msg), { status });
  }
}
