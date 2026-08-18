import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  getFacturacionModo,
  upsertFacturacionModo,
  type FacturacionModoTipo,
  type ImpresionTipo,
} from "@/lib/facturacion/server/facturacion-modo-pg";

const MODOS: FacturacionModoTipo[] = ["sin_factura_fiscal", "sifen", "autoimpresor"];
const IMPRESIONES: ImpresionTipo[] = ["pdf_a4", "pdf_media_hoja", "ticket_80mm", "ticket_58mm"];

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const row = await getFacturacionModo(schema, ctx.auth.empresa_id);
    return NextResponse.json(successResponse({ facturacion_modo: row }));
  } catch (err) {
    console.error("[/api/configuracion/facturacion-modo GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar la configuración."), { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Parameters<typeof upsertFacturacionModo>[2] = {};

    if (body.modo !== undefined) {
      const v = String(body.modo);
      if (!MODOS.includes(v as FacturacionModoTipo)) {
        return NextResponse.json(errorResponse("Modo de facturación inválido."), { status: 400 });
      }
      patch.modo = v as FacturacionModoTipo;
    }
    if (body.impresion_tipo_default !== undefined) {
      const v = String(body.impresion_tipo_default);
      if (!IMPRESIONES.includes(v as ImpresionTipo)) {
        return NextResponse.json(errorResponse("Tipo de impresión inválido."), { status: 400 });
      }
      patch.impresion_tipo_default = v as ImpresionTipo;
    }
    if (body.imprimir_al_confirmar !== undefined) patch.imprimir_al_confirmar = body.imprimir_al_confirmar === true;
    if (body.preguntar_datos_al_confirmar !== undefined) patch.preguntar_datos_al_confirmar = body.preguntar_datos_al_confirmar === true;
    if (body.activo !== undefined) patch.activo = body.activo === true;

    const row = await upsertFacturacionModo(schema, ctx.auth.empresa_id, patch);
    return NextResponse.json(successResponse({ facturacion_modo: row }));
  } catch (err) {
    console.error("[/api/configuracion/facturacion-modo PATCH]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo guardar la configuración."), { status: 500 });
  }
}
