import { NextRequest, NextResponse } from "next/server";
import { getFacturasSupabaseFromAuth } from "@/lib/facturacion/facturas-service-client";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { loadValidatedSifenPayload } from "@/lib/sifen/load-factura-payload";
import type { SifenApiPayloadGeneracionDetalle } from "@/lib/sifen/types";


/**
 * GET /api/facturas/[id]/sifen/payload
 * Arma el JSON base para SIFEN a partir de factura, ítems, cliente y config (sin XML ni SET).
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

    const { id: facturaId } = await params;
    if (!facturaId?.trim()) {
      return NextResponse.json(errorResponse("id de factura es obligatorio"), { status: 400 });
    }

    const fid = facturaId.trim();

    const loaded = await loadValidatedSifenPayload(supabase, auth.empresa_id, fid);
    if (!loaded.ok) {
      return NextResponse.json(errorResponse(loaded.error.message), {
        status: loaded.error.status,
      });
    }

    const detalle: SifenApiPayloadGeneracionDetalle = {
      origen: "api_payload",
      factura_id: fid,
    };

    const { error: errEvento } = await supabase.from("factura_electronica_evento").insert({
      empresa_id: auth.empresa_id,
      factura_electronica_id: loaded.payload.sifen.factura_electronica_id,
      tipo: "generacion",
      detalle,
    });

    if (errEvento) {
      return NextResponse.json(
        errorResponse(`No se pudo registrar el evento de generación: ${errEvento.message}`),
        { status: 500 }
      );
    }

    return NextResponse.json(successResponse(loaded.payload));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
