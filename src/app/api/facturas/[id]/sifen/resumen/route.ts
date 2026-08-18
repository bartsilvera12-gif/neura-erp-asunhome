import { NextRequest, NextResponse } from "next/server";
import { getFacturasSupabaseFromAuth } from "@/lib/facturacion/facturas-service-client";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { toFacturaElectronicaDto } from "@/lib/sifen/to-factura-electronica-dto";
import type { FacturaElectronicaDTO, SifenCancelacionPreviewDTO } from "@/lib/sifen/types";
import {
  buildSifenCancelacionPreview,
  normalizePlazoCancelacionHoras,
} from "@/lib/sifen/sifen-cancelacion-rules";


export type FacturaSifenResumenData = {
  sifen_config_exists: boolean;
  sifen_config_activa: boolean;
  /** `test` | `prod` si hay fila de config; null si no. */
  sifen_ambiente: string | null;
  /** Plazo vigente para cancelación (desde config SIFEN o default 48 h). */
  sifen_plazo_cancelacion_horas: number;
  factura_electronica: FacturaElectronicaDTO | null;
  cancelacion: SifenCancelacionPreviewDTO | null;
};

/**
 * GET /api/facturas/[id]/sifen/resumen
 * Config SIFEN (existencia/activo) + fila factura_electronica si existe (una sola ida a BD agrupada en handler).
 */
export async function GET(
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


    const { data: factura, error: errFactura } = await supabase
      .from("facturas")
      .select("id")
      .eq("id", fid)
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();

    if (errFactura) {
      return NextResponse.json(errorResponse(errFactura.message), { status: 400 });
    }
    if (!factura) {
      return NextResponse.json(errorResponse("Factura no encontrada"), { status: 404 });
    }

    const [{ data: cfg }, { data: fe }, pagosRes] = await Promise.all([
      supabase
        .from("empresa_sifen_config")
        .select("activo, ambiente, sifen_plazo_cancelacion_horas")
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

    const sifen_config_exists = cfg != null;
    const sifen_config_activa = Boolean(cfg && (cfg as { activo?: boolean }).activo);
    const ambienteRaw =
      cfg != null && (cfg as { ambiente?: string | null }).ambiente != null
        ? String((cfg as { ambiente?: string | null }).ambiente).trim()
        : "";
    const sifen_ambiente = ambienteRaw.length > 0 ? ambienteRaw : null;
    const sifen_plazo_cancelacion_horas = normalizePlazoCancelacionHoras(
      cfg != null ? (cfg as { sifen_plazo_cancelacion_horas?: unknown }).sifen_plazo_cancelacion_horas : 48
    );

    let feOut = fe;
    if (fe) {
      const row = fe as Record<string, unknown>;
      if (String(row.estado_sifen ?? "") === "error_envio") {
        const ult = row.sifen_ultima_respuesta_recibe_lote;
        const cod =
          ult != null && typeof ult === "object" && "dCodRes" in ult
            ? String((ult as Record<string, unknown>).dCodRes ?? "").trim()
            : "";
        const prot =
          row.sifen_d_prot_cons_lote == null ? "" : String(row.sifen_d_prot_cons_lote).trim();
        const httpSt =
          ult != null && typeof ult === "object" && "httpStatus" in ult
            ? Number((ult as Record<string, unknown>).httpStatus)
            : NaN;
        const httpOk = Number.isFinite(httpSt) && httpSt >= 200 && httpSt < 300;
        const codSin = cod.replace(/^0+/, "") || "";
        const es0300 = cod === "0300" || codSin === "300";
        const es0301 = cod === "0301" || codSin === "301";
        const debeCorregir =
          (es0300 && prot.length > 0) || (httpOk && prot.length > 0 && !es0301);
        if (debeCorregir) {
          const { data: fixed } = await supabase
            .from("factura_electronica")
            .update({ estado_sifen: "enviado", error: null })
            .eq("id", row.id)
            .eq("empresa_id", auth.empresa_id)
            .select()
            .single();
          if (fixed) feOut = fixed;
        }
      }
    }

    const feDto = feOut ? toFacturaElectronicaDto(feOut as Record<string, unknown>) : null;
    const cancelacion =
      feDto != null
        ? buildSifenCancelacionPreview({
            estadoSifen: feDto.estado_sifen,
            sifenAprobadoAtIso: feDto.sifen_aprobado_at,
            sifenCanceladoAtIso: feDto.sifen_cancelado_at,
            plazoHoras: sifen_plazo_cancelacion_horas,
            pagosCount,
            nowMs: Date.now(),
          })
        : null;

    const payload: FacturaSifenResumenData = {
      sifen_config_exists,
      sifen_config_activa,
      sifen_ambiente,
      sifen_plazo_cancelacion_horas,
      factura_electronica: feDto,
      cancelacion,
    };

    return NextResponse.json(successResponse(payload), {
      headers: {
        "Cache-Control": "private, no-store, max-age=0, must-revalidate",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
