import { NextRequest, NextResponse } from "next/server";
import { getFacturasSupabaseFromAuth } from "@/lib/facturacion/facturas-service-client";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { toFacturaElectronicaDto } from "@/lib/sifen/to-factura-electronica-dto";
import {
  buildSifenCancelacionPreview,
  normalizePlazoCancelacionHoras,
} from "@/lib/sifen/sifen-cancelacion-rules";
import type { FacturaElectronicaDTO } from "@/lib/sifen/types";

function trimMotivo(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  return s.length > 0 ? s : null;
}

/**
 * POST /api/facturas/[id]/sifen/cancelar
 * Cancelación lógica del DE (estado cancelado + trazas). No elimina la factura comercial.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getFacturasSupabaseFromAuth(request);
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
    const b = body != null && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const motivo = trimMotivo(b.motivo);
    if (motivo == null || motivo.length < 5) {
      return NextResponse.json(
        errorResponse("motivo es obligatorio (mínimo 5 caracteres) para registrar la cancelación."),
        { status: 400 }
      );
    }
    if (motivo.length > 2000) {
      return NextResponse.json(errorResponse("motivo no puede superar 2000 caracteres."), { status: 400 });
    }

    const { data: factura, error: errF } = await supabase
      .from("facturas")
      .select("id, empresa_id")
      .eq("id", fid)
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();

    if (errF) {
      return NextResponse.json(errorResponse(errF.message), { status: 400 });
    }
    if (!factura) {
      return NextResponse.json(errorResponse("Factura no encontrada"), { status: 404 });
    }

    const [{ data: cfg }, { data: feRow }, pagosRes] = await Promise.all([
      supabase
        .from("empresa_sifen_config")
        .select("sifen_plazo_cancelacion_horas")
        .eq("empresa_id", auth.empresa_id)
        .maybeSingle(),
      supabase.from("factura_electronica").select("*").eq("factura_id", fid).eq("empresa_id", auth.empresa_id).maybeSingle(),
      supabase
        .from("pagos")
        .select("id", { count: "exact", head: true })
        .eq("factura_id", fid)
        .eq("empresa_id", auth.empresa_id),
    ]);

    if (pagosRes.error) {
      return NextResponse.json(errorResponse(pagosRes.error.message), { status: 400 });
    }
    const pagosCount = pagosRes.count ?? 0;

    if (!feRow) {
      return NextResponse.json(
        errorResponse("No hay documento electrónico asociado a esta factura."),
        { status: 409 }
      );
    }

    const plazo = normalizePlazoCancelacionHoras(
      cfg != null ? (cfg as { sifen_plazo_cancelacion_horas?: unknown }).sifen_plazo_cancelacion_horas : 48
    );

    const feDto = toFacturaElectronicaDto(feRow as Record<string, unknown>);
    const preview = buildSifenCancelacionPreview({
      estadoSifen: feDto.estado_sifen,
      sifenAprobadoAtIso: feDto.sifen_aprobado_at,
      sifenCanceladoAtIso: feDto.sifen_cancelado_at,
      plazoHoras: plazo,
      pagosCount,
      nowMs: Date.now(),
    });

    if (!preview.puede_cancelar) {
      return NextResponse.json(
        errorResponse(preview.motivo_bloqueo ?? "No se puede cancelar el documento electrónico."),
        { status: 409 }
      );
    }

    const canceladoEn = new Date().toISOString();

    const { data: updatedFe, error: errUp } = await supabase
      .from("factura_electronica")
      .update({
        estado_sifen: "cancelado",
        sifen_cancelado_at: canceladoEn,
        sifen_cancelacion_motivo: motivo,
      })
      .eq("id", feDto.id)
      .eq("empresa_id", auth.empresa_id)
      .select()
      .single();

    if (errUp || !updatedFe) {
      return NextResponse.json(
        errorResponse(errUp?.message ?? "No se pudo actualizar factura_electronica."),
        { status: 500 }
      );
    }

    const { data: evInsert, error: errEv } = await supabase
      .from("factura_electronica_evento")
      .insert({
        empresa_id: auth.empresa_id,
        factura_electronica_id: feDto.id,
        tipo: "cancelacion",
        detalle: {
          origen: "api_cancelar",
          factura_id: fid,
          motivo,
          cancelado_en: canceladoEn,
        },
      })
      .select("id")
      .single();

    if (errEv || !evInsert) {
      await supabase
        .from("factura_electronica")
        .update({
          estado_sifen: feDto.estado_sifen,
          sifen_cancelado_at: feDto.sifen_cancelado_at,
          sifen_cancelacion_motivo: feDto.sifen_cancelacion_motivo,
        })
        .eq("id", feDto.id)
        .eq("empresa_id", auth.empresa_id);
      return NextResponse.json(
        errorResponse(`No se pudo registrar el evento; se revirtió el estado: ${errEv?.message ?? "error"}`),
        { status: 500 }
      );
    }

    const { error: errFactura } = await supabase
      .from("facturas")
      .update({ estado: "Anulado", saldo: 0 })
      .eq("id", fid)
      .eq("empresa_id", auth.empresa_id);

    if (errFactura) {
      await supabase
        .from("factura_electronica")
        .update({
          estado_sifen: feDto.estado_sifen,
          sifen_cancelado_at: feDto.sifen_cancelado_at,
          sifen_cancelacion_motivo: feDto.sifen_cancelacion_motivo,
        })
        .eq("id", feDto.id)
        .eq("empresa_id", auth.empresa_id);
      await supabase.from("factura_electronica_evento").delete().eq("id", (evInsert as { id: string }).id);
      return NextResponse.json(
        errorResponse(
          `No se pudo anular la factura comercial (${errFactura.message}); se revirtió la cancelación del DE.`
        ),
        { status: 500 }
      );
    }

    const dto = toFacturaElectronicaDto(updatedFe as Record<string, unknown>);
    const data: { factura_electronica: FacturaElectronicaDTO } = {
      factura_electronica: dto,
    };

    return NextResponse.json(successResponse(data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
