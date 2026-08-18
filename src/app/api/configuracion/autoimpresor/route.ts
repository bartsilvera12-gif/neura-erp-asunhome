import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  getAutoimpresor,
  upsertAutoimpresor,
  validateAutoimpresor,
  type AutoimpresorPatch,
  type ImpresionTipo,
} from "@/lib/facturacion/server/facturacion-modo-pg";

const IMPRESIONES: ImpresionTipo[] = ["pdf_a4", "pdf_media_hoja", "ticket_80mm", "ticket_58mm"];
const TIPOS_DOC = ["factura", "ticket", "nota_venta", "otro"];

function str(v: unknown): string | null {
  if (v == null || v === "") return null;
  return String(v).trim().toUpperCase();
}
function strKeep(v: unknown): string | null {
  if (v == null || v === "") return null;
  return String(v).trim();
}
function intN(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}
function dateN(v: unknown): string | null {
  if (v == null || v === "") return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const row = await getAutoimpresor(schema, ctx.auth.empresa_id);
    return NextResponse.json(successResponse({ autoimpresor: row }));
  } catch (err) {
    console.error("[/api/configuracion/autoimpresor GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar la configuración."), { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const patch: AutoimpresorPatch = {
      activo: body.activo === undefined ? undefined : body.activo === true,
      ruc_emisor: body.ruc_emisor === undefined ? undefined : strKeep(body.ruc_emisor),
      razon_social_emisor: body.razon_social_emisor === undefined ? undefined : str(body.razon_social_emisor),
      nombre_fantasia: body.nombre_fantasia === undefined ? undefined : str(body.nombre_fantasia),
      direccion_matriz: body.direccion_matriz === undefined ? undefined : str(body.direccion_matriz),
      telefono: body.telefono === undefined ? undefined : strKeep(body.telefono),
      timbrado_numero: body.timbrado_numero === undefined ? undefined : strKeep(body.timbrado_numero),
      timbrado_inicio_vigencia: body.timbrado_inicio_vigencia === undefined ? undefined : dateN(body.timbrado_inicio_vigencia),
      timbrado_fin_vigencia: body.timbrado_fin_vigencia === undefined ? undefined : dateN(body.timbrado_fin_vigencia),
      establecimiento_codigo: body.establecimiento_codigo === undefined ? undefined : strKeep(body.establecimiento_codigo),
      punto_expedicion_codigo: body.punto_expedicion_codigo === undefined ? undefined : strKeep(body.punto_expedicion_codigo),
      numero_actual: body.numero_actual === undefined ? undefined : intN(body.numero_actual),
      numero_inicial: body.numero_inicial === undefined ? undefined : intN(body.numero_inicial),
      numero_final: body.numero_final === undefined ? undefined : intN(body.numero_final),
      tipo_documento_default: body.tipo_documento_default === undefined ? undefined :
        (TIPOS_DOC.includes(String(body.tipo_documento_default)) ? String(body.tipo_documento_default) : "factura"),
      formato_impresion_default: body.formato_impresion_default === undefined ? undefined :
        (IMPRESIONES.includes(String(body.formato_impresion_default) as ImpresionTipo)
          ? String(body.formato_impresion_default) as ImpresionTipo : "pdf_a4"),
      leyenda_papel_termico: body.leyenda_papel_termico === undefined ? undefined : str(body.leyenda_papel_termico),
      observaciones: body.observaciones === undefined ? undefined : str(body.observaciones),
    };

    // Si activamos autoimpresor, validar campos minimos
    if (patch.activo === true) {
      // Tomar valores fusionados con lo que ya hay en DB para validar correctamente
      const actual = await getAutoimpresor(schema, ctx.auth.empresa_id);
      const merged = { ...actual, ...patch };
      const errors = validateAutoimpresor({ ...merged, activo: true });
      if (errors.length > 0) {
        return NextResponse.json(errorResponse(errors.join(" · ")), { status: 400 });
      }
    }

    const row = await upsertAutoimpresor(schema, ctx.auth.empresa_id, patch);
    return NextResponse.json(successResponse({ autoimpresor: row }));
  } catch (err) {
    console.error("[/api/configuracion/autoimpresor PATCH]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo guardar la configuración."), { status: 500 });
  }
}
