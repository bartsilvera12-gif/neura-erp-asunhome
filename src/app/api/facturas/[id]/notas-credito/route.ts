import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { createNotaCreditoBorrador } from "@/lib/nota-credito/create-nota-credito";
import { evaluateNotaCreditoCreationGate } from "@/lib/nota-credito/evaluate-creation-gate";
import type { NotaCreditoCreateBody, NotaCreditoListItemDTO } from "@/lib/nota-credito/types";
import { obtenerSifenPrevueloFacturaParaNcs } from "@/lib/nota-credito/pre-vuelo-nc-sifen";

function compactSetResponses(ne: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!ne) return null;
  const rec = ne.sifen_ultima_respuesta_recibe_lote;
  const cons = ne.sifen_ultima_respuesta_consulta_lote;
  if (rec == null && cons == null) return null;
  const out: Record<string, unknown> = {};
  if (rec != null && typeof rec === "object") out.recibe_lote = rec;
  if (cons != null && typeof cons === "object") out.consulta_lote = cons;
  return Object.keys(out).length ? out : null;
}

function mapListRow(r: Record<string, unknown>): NotaCreditoListItemDTO {
  const ne = r.nota_credito_electronica as Record<string, unknown> | null | undefined;
  return {
    id: String(r.id),
    monto: Number(r.monto),
    motivo: String(r.motivo),
    observacion_interna: r.observacion_interna == null ? null : String(r.observacion_interna),
    estado_erp: String(r.estado_erp) as NotaCreditoListItemDTO["estado_erp"],
    created_at: String(r.created_at ?? ""),
    created_by_user_id: r.created_by_user_id == null ? null : String(r.created_by_user_id),
    created_by_email_snapshot: r.created_by_email_snapshot == null ? null : String(r.created_by_email_snapshot),
    created_by_nombre_snapshot: r.created_by_nombre_snapshot == null ? null : String(r.created_by_nombre_snapshot),
    saldo_previo_snapshot: Number(r.saldo_previo_snapshot),
    monto_factura_snapshot: Number(r.monto_factura_snapshot),
    suma_pagos_snapshot: Number(r.suma_pagos_snapshot),
    moneda_snapshot: String(r.moneda_snapshot),
    estado_sifen: ne?.estado_sifen == null ? null : (String(ne.estado_sifen) as NotaCreditoListItemDTO["estado_sifen"]),
    cdc: ne?.cdc == null ? null : String(ne.cdc),
    cdc_factura_origen: ne?.cdc_factura_origen == null ? null : String(ne.cdc_factura_origen),
    last_error: ne?.last_error == null ? null : String(ne.last_error),
    xml_path: ne?.xml_path == null || String(ne.xml_path).trim() === "" ? null : String(ne.xml_path),
    xml_firmado_path:
      ne?.xml_firmado_path == null || String(ne.xml_firmado_path).trim() === ""
        ? null
        : String(ne.xml_firmado_path),
    sifen_respuestas_set: compactSetResponses(ne),
  };
}

/**
 * GET /api/facturas/[id]/notas-credito — listado + gate para crear.
 * POST — crea NC borrador (fase 1, sin SIFEN).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;
    const { id } = await params;
    const fid = id?.trim();
    if (!fid) {
      return NextResponse.json(errorResponse("id de factura es obligatorio"), { status: 400 });
    }

    const { data: factura, error: errF } = await supabase
      .from("facturas")
      .select("id")
      .eq("id", fid)
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();

    if (errF) {
      return NextResponse.json(errorResponse(errF.message), { status: 400 });
    }
    if (!factura) {
      return NextResponse.json(errorResponse("Factura no encontrada"), { status: 404 });
    }

    const gate = await evaluateNotaCreditoCreationGate(supabase, auth.empresa_id, fid);
    const sifen_prevuelo_factura = await obtenerSifenPrevueloFacturaParaNcs(supabase, auth.empresa_id, fid);

    const { data: rows, error: errL } = await supabase
      .from("nota_credito")
      .select(
        "id, monto, motivo, observacion_interna, estado_erp, created_at, created_by_user_id, created_by_email_snapshot, created_by_nombre_snapshot, saldo_previo_snapshot, monto_factura_snapshot, suma_pagos_snapshot, moneda_snapshot, nota_credito_electronica(estado_sifen, cdc, cdc_factura_origen, last_error, xml_path, xml_firmado_path, sifen_ultima_respuesta_recibe_lote, sifen_ultima_respuesta_consulta_lote)"
      )
      .eq("factura_id", fid)
      .eq("empresa_id", auth.empresa_id)
      .order("created_at", { ascending: false });

    if (errL) {
      return NextResponse.json(errorResponse(errL.message), { status: 400 });
    }

    const items = (rows ?? []).map((x) => mapListRow(x as unknown as Record<string, unknown>));

    return NextResponse.json(
      successResponse({
        items,
        puede_crear: gate.puede_crear,
        motivo_bloqueo_creacion: gate.motivo_bloqueo,
        sifen_prevuelo_factura,
      })
    );
  } catch (e) {
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "Error interno"),
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;
    const { id } = await params;
    const fid = id?.trim();
    if (!fid) {
      return NextResponse.json(errorResponse("id de factura es obligatorio"), { status: 400 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(errorResponse("Cuerpo JSON inválido"), { status: 400 });
    }
    const b = (body ?? {}) as NotaCreditoCreateBody;

    const result = await createNotaCreditoBorrador({
      supabase,
      empresaId: auth.empresa_id,
      facturaId: fid,
      authUserId: auth.user.id,
      authEmail: auth.user.email ?? null,
      authNombre: auth.nombre ?? null,
      motivo: b.motivo ?? "",
      observacionInterna: b.observacion_interna ?? null,
    });

    if (!result.ok) {
      return NextResponse.json(errorResponse(result.error), { status: result.status });
    }

    return NextResponse.json(successResponse({ nota_credito_id: result.nota_credito_id }));
  } catch (e) {
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "Error interno"),
      { status: 500 }
    );
  }
}
